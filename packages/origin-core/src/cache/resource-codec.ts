import type { CachedResourceStoredResult } from "./resource-l1.js";

const RESOURCE_MARKER = "originloom.cached-resource";
const RESOURCE_CODEC_VERSION = 1;

type ResourceEnvelope = {
  marker: typeof RESOURCE_MARKER;
  codec: typeof RESOURCE_CODEC_VERSION;
  namespace: string;
  version: string;
  storedAt: number;
  result: { kind: "value"; value: unknown } | { kind: "not-found" } | { kind: "no-content" };
};

export type CachedResourceDecodeResult<T> =
  | { ok: true; storedAt: number; result: CachedResourceStoredResult<T> }
  | { ok: false; reason: "corrupt" | "codec_version" | "resource_version" | "invalid_value" };

export function encodeCachedResource<T>(options: {
  namespace: string;
  version: string;
  storedAt: number;
  result: CachedResourceStoredResult<T>;
  serialize: (value: T) => unknown;
}): string {
  const result =
    options.result.kind === "value"
      ? { kind: "value" as const, value: options.serialize(options.result.value) }
      : options.result;
  const envelope: ResourceEnvelope = {
    marker: RESOURCE_MARKER,
    codec: RESOURCE_CODEC_VERSION,
    namespace: options.namespace,
    version: options.version,
    storedAt: options.storedAt,
    result,
  };
  return JSON.stringify(envelope);
}

export function decodeCachedResource<T>(options: {
  body: string;
  namespace: string;
  version: string;
  parse: (value: unknown) => T;
}): CachedResourceDecodeResult<T> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(options.body) as unknown;
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!isRecord(envelope) || envelope.marker !== RESOURCE_MARKER) {
    return { ok: false, reason: "corrupt" };
  }
  if (envelope.codec !== RESOURCE_CODEC_VERSION) {
    return { ok: false, reason: "codec_version" };
  }
  if (envelope.namespace !== options.namespace || envelope.version !== options.version) {
    return { ok: false, reason: "resource_version" };
  }
  if (!Number.isSafeInteger(envelope.storedAt) || (envelope.storedAt as number) < 0) {
    return { ok: false, reason: "corrupt" };
  }
  if (!isRecord(envelope.result) || typeof envelope.result.kind !== "string") {
    return { ok: false, reason: "corrupt" };
  }
  if (envelope.result.kind === "not-found" || envelope.result.kind === "no-content") {
    return {
      ok: true,
      storedAt: envelope.storedAt as number,
      result: { kind: envelope.result.kind },
    };
  }
  if (envelope.result.kind !== "value" || !("value" in envelope.result)) {
    return { ok: false, reason: "corrupt" };
  }
  try {
    return {
      ok: true,
      storedAt: envelope.storedAt as number,
      result: { kind: "value", value: options.parse(envelope.result.value) },
    };
  } catch {
    return { ok: false, reason: "invalid_value" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
