import type { Pagination } from "~/lib/contracts/pagination";

export const MAX_COLLECTION = 100;
export const MAX_PAGES = 500;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isString(value: unknown, max = 4_000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function isOptionalString(value: unknown, max = 256): value is string | null {
  return value === null || isString(value, max);
}

export function isNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function isInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isInteger(value) && isNumber(value, min, max);
}

export function isStringArray(value: unknown, maxItems = 50, maxLength = 1_000): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isString(item, maxLength))
  );
}

export function isPagination(value: unknown): value is Pagination {
  if (!isRecord(value)) return false;
  return (
    isInteger(value.page, 1, MAX_PAGES) &&
    isInteger(value.pageSize, 1, MAX_COLLECTION) &&
    isInteger(value.total, 0, 1_000_000) &&
    isInteger(value.totalPages, 1, MAX_PAGES) &&
    typeof value.hasPrevious === "boolean" &&
    typeof value.hasNext === "boolean"
  );
}

export function isIsoDate(value: unknown): value is string {
  return isString(value, 64) && Number.isFinite(Date.parse(value));
}
