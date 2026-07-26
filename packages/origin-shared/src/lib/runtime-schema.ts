export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isBoundedString(value: unknown, maxLength: number, minLength = 1): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
}

export function isFiniteNumber(
  value: unknown,
  options: { min?: number; max?: number; integer?: boolean } = {},
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (options.integer && !Number.isSafeInteger(value)) return false;
  if (options.min !== undefined && value < options.min) return false;
  if (options.max !== undefined && value > options.max) return false;
  return true;
}

export function isBoundedArray<T>(
  value: unknown,
  maxItems: number,
  itemGuard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(itemGuard);
}
