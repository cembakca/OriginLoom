export type CachedResourceStoredResult<T> =
  { kind: "value"; value: T } | { kind: "not-found" } | { kind: "no-content" };

export type CachedResourceMemoryEntry<T> = {
  body: string;
  result: CachedResourceStoredResult<T>;
  storedAt: number;
  freshUntil: number;
  swrUntil: number;
  staleUntil: number;
};
