import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import { findSsrFragmentMarkers, type SsrFragmentMarker } from "@originloom/shared/fragment-markup";

import { logger } from "../logger.js";
import { hasUnsafeConcreteCachedHtmlValues } from "./dynamic-html.js";
import { normalizeDependencyTags } from "./tags.js";
import type { CacheEntry } from "./types.js";

/**
 * Wire format for a cached HTML entry:
 *   [4 bytes magic][1 byte version][1 byte encoding]
 *   [8 bytes freshUntil][8 bytes staleUntil][payload]
 *
 * Only full HTML documents are compressed. Small JSON/service cache values use
 * the raw encoding, avoiding CPU and framing overhead where Brotli cannot help.
 */
const MAGIC = Buffer.from("SSRC");
const FORMAT_VERSION = 4;
const COMPILED_MARKER_VERSION = 3;
const FRAGMENT_FLAG_VERSION = 2;
const LEGACY_BINARY_VERSION = 1;
const ENCODING_RAW = 0;
const ENCODING_BROTLI_HTML = 1;
const FRAGMENT_FLAG = 0x80;
const HEADER_BYTES = MAGIC.length + 1 + 1 + 8 + 8;
const MARKER_LENGTH_BYTES = 4;
const MAX_ENTRY_METADATA_BYTES = 64 * 1024;
const HTML_COMPRESSION_THRESHOLD_BYTES = 1_024;
const BROTLI_QUALITY = 8;
const BROTLI_WINDOW_BITS = 19;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function encodeCacheEntry(entry: CacheEntry): Buffer {
  const raw = Buffer.from(entry.body, "utf8");
  const encoded = encodeBody(raw, entry.body);
  const fragmentMarkers = entry.fragmentMarkers ?? findSsrFragmentMarkers(entry.body);
  const metadata = encodeEntryMetadata(fragmentMarkers, entry.tags);

  const header = Buffer.allocUnsafe(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(FORMAT_VERSION, MAGIC.length);
  const hasFragments = fragmentMarkers.length > 0;
  header.writeUInt8(encoded.encoding | (hasFragments ? FRAGMENT_FLAG : 0), MAGIC.length + 1);
  header.writeBigInt64BE(BigInt(Math.trunc(entry.freshUntil)), MAGIC.length + 2);
  header.writeBigInt64BE(BigInt(Math.trunc(entry.staleUntil)), MAGIC.length + 10);

  const markerLength = Buffer.allocUnsafe(MARKER_LENGTH_BYTES);
  markerLength.writeUInt32BE(metadata.length);
  return Buffer.concat([header, markerLength, metadata, encoded.payload]);
}

/** Never throws — legacy JSON, current binary, and corrupt entries have explicit outcomes. */
export function decodeCacheEntry(buf: Buffer): CacheEntry | null {
  const legacy = decodeLegacyJsonEntry(buf);
  if (legacy) return legacy;
  if (buf.length < HEADER_BYTES) return null;
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  const version = buf.readUInt8(MAGIC.length);
  if (
    version !== FORMAT_VERSION &&
    version !== COMPILED_MARKER_VERSION &&
    version !== FRAGMENT_FLAG_VERSION &&
    version !== LEGACY_BINARY_VERSION
  )
    return null;

  try {
    const encodedFlags = buf.readUInt8(MAGIC.length + 1);
    const encoding = encodedFlags & ~FRAGMENT_FLAG;
    const freshUntil = Number(buf.readBigInt64BE(MAGIC.length + 2));
    const staleUntil = Number(buf.readBigInt64BE(MAGIC.length + 10));
    const { payload, encodedMarkers, encodedTags } =
      version === FORMAT_VERSION
        ? decodeVersionFourPayload(buf)
        : version === COMPILED_MARKER_VERSION
          ? decodeVersionThreePayload(buf)
          : {
              payload: buf.subarray(HEADER_BYTES),
              encodedMarkers: undefined,
              encodedTags: undefined,
            };
    const body =
      encoding === ENCODING_RAW
        ? utf8Decoder.decode(payload)
        : encoding === ENCODING_BROTLI_HTML
          ? utf8Decoder.decode(brotliDecompressSync(payload))
          : null;
    if (body === null || !validTimestamps(freshUntil, staleUntil)) return null;
    if (isHtmlDocument(body) && hasUnsafeConcreteCachedHtmlValues(body)) return null;
    const fragmentMarkers =
      encodedMarkers ??
      ((encodedFlags & FRAGMENT_FLAG) !== 0 || version === LEGACY_BINARY_VERSION
        ? findSsrFragmentMarkers(body)
        : []);
    if (!validFragmentMarkers(fragmentMarkers, body)) return null;
    return {
      body,
      freshUntil,
      staleUntil,
      hasFragments: fragmentMarkers.length > 0,
      fragmentMarkers,
      ...(encodedTags?.length ? { tags: encodedTags } : {}),
    };
  } catch (error) {
    logger.warn("cache entry decode failed; treating as miss", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function encodeBody(raw: Buffer, body: string): { encoding: number; payload: Buffer } {
  if (raw.length < HTML_COMPRESSION_THRESHOLD_BYTES || !isHtmlDocument(body)) {
    return { encoding: ENCODING_RAW, payload: raw };
  }
  try {
    const compressed = brotliCompressSync(raw, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [constants.BROTLI_PARAM_LGWIN]: BROTLI_WINDOW_BITS,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    return compressed.length < raw.length
      ? { encoding: ENCODING_BROTLI_HTML, payload: compressed }
      : { encoding: ENCODING_RAW, payload: raw };
  } catch (error) {
    logger.warn("cache entry compression failed; storing raw value", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { encoding: ENCODING_RAW, payload: raw };
  }
}

function encodeEntryMetadata(
  markers: readonly SsrFragmentMarker[],
  tags?: readonly string[],
): Buffer {
  const normalizedTags = normalizeDependencyTags(tags);
  if (markers.length === 0 && normalizedTags.length === 0) return Buffer.alloc(0);
  const encoded = Buffer.from(
    JSON.stringify({
      m: markers.map(({ name, start, end }) => [name, start, end]),
      t: normalizedTags,
    }),
  );
  if (encoded.length > MAX_ENTRY_METADATA_BYTES) {
    throw new Error("cache entry metadata too large");
  }
  return encoded;
}

function decodeVersionFourPayload(buf: Buffer): {
  payload: Buffer;
  encodedMarkers: SsrFragmentMarker[];
  encodedTags: readonly string[];
} {
  if (buf.length < HEADER_BYTES + MARKER_LENGTH_BYTES)
    throw new Error("cache metadata header missing");
  const metadataLength = buf.readUInt32BE(HEADER_BYTES);
  if (metadataLength > MAX_ENTRY_METADATA_BYTES) throw new Error("cache entry metadata too large");
  const metadataStart = HEADER_BYTES + MARKER_LENGTH_BYTES;
  const payloadStart = metadataStart + metadataLength;
  if (payloadStart > buf.length) throw new Error("cache entry metadata truncated");
  if (metadataLength === 0) {
    return { payload: buf.subarray(payloadStart), encodedMarkers: [], encodedTags: [] };
  }
  const value = JSON.parse(
    utf8Decoder.decode(buf.subarray(metadataStart, payloadStart)),
  ) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid cache entry metadata");
  }
  const metadata = value as Record<string, unknown>;
  return {
    payload: buf.subarray(payloadStart),
    encodedMarkers: decodeFragmentMarkers(metadata.m),
    encodedTags: decodeDependencyTags(metadata.t),
  };
}

function decodeVersionThreePayload(buf: Buffer): {
  payload: Buffer;
  encodedMarkers: SsrFragmentMarker[];
  encodedTags: undefined;
} {
  if (buf.length < HEADER_BYTES + MARKER_LENGTH_BYTES)
    throw new Error("cache marker header missing");
  const metadataLength = buf.readUInt32BE(HEADER_BYTES);
  if (metadataLength > MAX_ENTRY_METADATA_BYTES) throw new Error("cache marker metadata too large");
  const metadataStart = HEADER_BYTES + MARKER_LENGTH_BYTES;
  const payloadStart = metadataStart + metadataLength;
  if (payloadStart > buf.length) throw new Error("cache marker metadata truncated");
  const encodedMarkers =
    metadataLength === 0
      ? []
      : decodeFragmentMarkers(
          JSON.parse(utf8Decoder.decode(buf.subarray(metadataStart, payloadStart))),
        );
  return { payload: buf.subarray(payloadStart), encodedMarkers, encodedTags: undefined };
}

function decodeDependencyTags(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new Error("invalid cache dependency tags");
  }
  return normalizeDependencyTags(value as string[]);
}

function decodeFragmentMarkers(value: unknown): SsrFragmentMarker[] {
  if (!Array.isArray(value)) throw new Error("invalid cache marker metadata");
  return value.map((item) => {
    if (
      !Array.isArray(item) ||
      item.length !== 3 ||
      typeof item[0] !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(item[0]) ||
      !Number.isSafeInteger(item[1]) ||
      !Number.isSafeInteger(item[2])
    ) {
      throw new Error("invalid cache marker");
    }
    return { name: item[0], start: item[1] as number, end: item[2] as number };
  });
}

function validFragmentMarkers(markers: readonly SsrFragmentMarker[], body: string): boolean {
  let previousEnd = 0;
  for (const marker of markers) {
    if (marker.start < previousEnd || marker.end <= marker.start || marker.end > body.length) {
      return false;
    }
    if (body.slice(previousEnd, marker.start).includes("<ssr-fragment ")) return false;
    const value = body.slice(marker.start, marker.end);
    if (!value.startsWith(`<ssr-fragment name="${marker.name}" `)) return false;
    previousEnd = marker.end;
  }
  return !body.slice(previousEnd).includes("<ssr-fragment ");
}

function isHtmlDocument(body: string): boolean {
  const start = body.trimStart().slice(0, 32).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function decodeLegacyJsonEntry(buf: Buffer): CacheEntry | null {
  if (buf.subarray(0, 64).toString("utf8").trimStart()[0] !== "{") return null;
  try {
    const value = JSON.parse(utf8Decoder.decode(buf)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.body !== "string" ||
      typeof entry.freshUntil !== "number" ||
      typeof entry.staleUntil !== "number" ||
      !validTimestamps(entry.freshUntil, entry.staleUntil)
    ) {
      return null;
    }
    if (isHtmlDocument(entry.body) && hasUnsafeConcreteCachedHtmlValues(entry.body)) return null;
    const fragmentMarkers = findSsrFragmentMarkers(entry.body);
    return {
      body: entry.body,
      freshUntil: entry.freshUntil,
      staleUntil: entry.staleUntil,
      hasFragments: fragmentMarkers.length > 0,
      fragmentMarkers,
    };
  } catch {
    return null;
  }
}

function validTimestamps(freshUntil: number, staleUntil: number): boolean {
  return (
    Number.isSafeInteger(freshUntil) &&
    Number.isSafeInteger(staleUntil) &&
    freshUntil >= 0 &&
    staleUntil >= freshUntil
  );
}
