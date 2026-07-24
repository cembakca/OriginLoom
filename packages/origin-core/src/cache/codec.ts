import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import { logger } from "../logger.js";
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
const FORMAT_VERSION = 1;
const ENCODING_RAW = 0;
const ENCODING_BROTLI_HTML = 1;
const HEADER_BYTES = MAGIC.length + 1 + 1 + 8 + 8;
const HTML_COMPRESSION_THRESHOLD_BYTES = 1_024;
const BROTLI_QUALITY = 8;
const BROTLI_WINDOW_BITS = 19;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function encodeCacheEntry(entry: CacheEntry): Buffer {
  const raw = Buffer.from(entry.body, "utf8");
  const encoded = encodeBody(raw, entry.body);

  const header = Buffer.allocUnsafe(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(FORMAT_VERSION, MAGIC.length);
  header.writeUInt8(encoded.encoding, MAGIC.length + 1);
  header.writeBigInt64BE(BigInt(Math.trunc(entry.freshUntil)), MAGIC.length + 2);
  header.writeBigInt64BE(BigInt(Math.trunc(entry.staleUntil)), MAGIC.length + 10);

  return Buffer.concat([header, encoded.payload]);
}

/** Never throws — legacy JSON, current binary, and corrupt entries have explicit outcomes. */
export function decodeCacheEntry(buf: Buffer): CacheEntry | null {
  const legacy = decodeLegacyJsonEntry(buf);
  if (legacy) return legacy;
  if (buf.length < HEADER_BYTES) return null;
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  if (buf.readUInt8(MAGIC.length) !== FORMAT_VERSION) return null;

  try {
    const encoding = buf.readUInt8(MAGIC.length + 1);
    const freshUntil = Number(buf.readBigInt64BE(MAGIC.length + 2));
    const staleUntil = Number(buf.readBigInt64BE(MAGIC.length + 10));
    const payload = buf.subarray(HEADER_BYTES);
    const body =
      encoding === ENCODING_RAW
        ? utf8Decoder.decode(payload)
        : encoding === ENCODING_BROTLI_HTML
          ? utf8Decoder.decode(brotliDecompressSync(payload))
          : null;
    if (body === null || !validTimestamps(freshUntil, staleUntil)) return null;
    return { body, freshUntil, staleUntil };
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
    return {
      body: entry.body,
      freshUntil: entry.freshUntil,
      staleUntil: entry.staleUntil,
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
