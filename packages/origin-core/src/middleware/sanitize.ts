const MAX_LEN = 256;
const SAFE = /^[\w\-./:%@]+$/;

export function sanitizeValue(
  raw: string | null | undefined,
  maxLen = MAX_LEN,
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().slice(0, maxLen);
  if (!trimmed || !SAFE.test(trimmed)) return undefined;
  return trimmed;
}

export function sanitizeUuid(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return /^[\da-f-]{36}$/i.test(raw) ? raw : undefined;
}
