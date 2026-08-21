export const MAX_TAGS_PER_ENTRY = 16;
export const MAX_TAG_LENGTH = 128;
export const MAX_TAG_KEYS = 500;
export const MAX_INDEXED_TAGS = 2_048;
export const MAX_TAGS_PER_OPERATION = 8;

const TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/;

export function isDependencyTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TAG_LENGTH &&
    TAG_PATTERN.test(value)
  );
}

export function normalizeDependencyTags(tags?: readonly string[]): readonly string[] {
  if (!tags || tags.length === 0) return [];
  if (tags.length > MAX_TAGS_PER_ENTRY) {
    throw new Error(`Cache entry may declare at most ${MAX_TAGS_PER_ENTRY} dependency tags`);
  }
  const normalized = [...new Set(tags)];
  if (normalized.length > MAX_TAGS_PER_ENTRY || normalized.some((tag) => !isDependencyTag(tag))) {
    throw new Error("Invalid cache dependency tag");
  }
  return normalized.sort();
}

export function normalizeTagOperation(tags: readonly string[]): readonly string[] {
  if (tags.length === 0 || tags.length > MAX_TAGS_PER_OPERATION) {
    throw new Error(`Tag operation requires 1-${MAX_TAGS_PER_OPERATION} tags`);
  }
  const normalized = [...new Set(tags)];
  if (normalized.some((tag) => !isDependencyTag(tag))) {
    throw new Error("Invalid cache dependency tag");
  }
  return normalized.sort();
}
