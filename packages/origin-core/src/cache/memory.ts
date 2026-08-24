import type { CachePolicy } from "@originloom/shared/lib/types";

import { observeL1CacheEviction, observeL1CacheRejection, setL1CacheState } from "../metrics.js";
import {
  CACHE_NAMESPACES,
  type CacheMemoryWriteOptions,
  type CacheNamespace,
  defaultL1MemoryOptions,
  inferCacheNamespace,
  type L1MemoryOptions,
} from "./l1-policy.js";
import {
  MAX_INDEXED_TAGS,
  MAX_TAG_KEYS,
  normalizeDependencyTags,
  normalizeTagOperation,
} from "./tags.js";
import {
  buildCacheEntry,
  type CacheEntry,
  cacheEntryFragmentMarkers,
  type CacheReadResult,
  type CacheStore,
  type ListKeysOptions,
  type ListKeysResult,
  type RateLimitResult,
  type TagInvalidationResult,
} from "./types.js";

export type { CacheNamespace, L1MemoryOptions } from "./l1-policy.js";

type EvictionReason = "entry_limit" | "expired" | "global_budget" | "namespace_budget";
type RejectionReason =
  | "entry_limit"
  | "entry_too_large"
  | "global_budget"
  | "namespace_budget"
  | "reserved_capacity"
  | "tag_cardinality";

type NamespaceUsage = { bytes: number; entries: number };

export class MemoryStore implements CacheStore {
  private readonly store = new Map<string, CacheEntry>();
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();
  private readonly ephemeral = new Map<string, { value: string; expiresAt: number }>();
  private readonly rateLimits = new Map<string, { used: number; resetAt: number }>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly usage = new Map<CacheNamespace, NamespaceUsage>();
  private readonly options: L1MemoryOptions;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupDeadline: number | undefined;
  private totalBytes = 0;

  constructor(
    private readonly maxEntries: number,
    options: L1MemoryOptions = defaultL1MemoryOptions(maxEntries),
  ) {
    this.options = options;
    for (const namespace of CACHE_NAMESPACES) {
      this.usage.set(namespace, { bytes: 0, entries: 0 });
      setL1CacheState(namespace, 0, 0);
    }
  }

  get size(): number {
    return this.store.size;
  }

  get currentBytes(): number {
    return this.totalBytes;
  }

  namespaceUsage(namespace: CacheNamespace): Readonly<NamespaceUsage> {
    return { ...this.usageFor(namespace) };
  }

  auxiliarySizes(): { locks: number; ephemeralValues: number; rateLimits: number } {
    return {
      locks: this.locks.size,
      ephemeralValues: this.ephemeral.size,
      rateLimits: this.rateLimits.size,
    };
  }

  async read(key: string): Promise<CacheReadResult | null> {
    return this.readSync(key);
  }

  /**
   * Sync twin of `read()` — identical eviction/MRU/shape semantics, no
   * `async` function wrapper. This is the hot-path entry point: `cache.read()`
   * calls it directly (no span, no Promise microtask) for a fresh hit, and
   * only falls through to the fully-traced path otherwise. See
   * `CacheStore.readSync` and `cache/index.ts`.
   *
   * This is a read, not an inspection: it reorders MRU and evicts an expired
   * entry, exactly as `read()` always has.
   */
  readSync(key: string): CacheReadResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now >= entry.staleUntil) {
      this.removeEntry(key, "expired");
      return null;
    }

    // Map insertion order is the recency list: a hit moves the entry to MRU.
    this.store.delete(key);
    this.store.set(key, entry);
    const fragmentMarkers = cacheEntryFragmentMarkers(entry);
    // Built by assignment rather than conditional spread: `...(c ? {} : {x})`
    // allocates a throwaway literal for *both* arms on every read, and this
    // runs once per cache consumer per request. The resulting object is the
    // same shape either way.
    const result: CacheReadResult = {
      body: entry.body,
      state: now < entry.freshUntil ? "fresh" : "stale",
      hasFragments: fragmentMarkers.length > 0,
      fragmentMarkers,
    };
    if (entry.memoryValue !== undefined) result.memoryValue = entry.memoryValue;
    if (entry.tags?.length) result.tags = entry.tags;
    return result;
  }

  async write(
    key: string,
    body: string,
    policy: CachePolicy,
    memory?: CacheMemoryWriteOptions,
  ): Promise<boolean> {
    if (policy.kind !== "shared") return false;
    return this.writeEntry(key, buildCacheEntry(body, policy, memory));
  }

  /** Writes an entry preserving absolute fresh/stale deadlines (L2 promotion path). */
  async writeEntry(key: string, source: CacheEntry): Promise<boolean> {
    if (Date.now() >= source.staleUntil) return false;
    const tags = normalizeDependencyTags(source.tags);
    const { tags: _sourceTags, ...sourceWithoutTags } = source;
    const normalizedSource: CacheEntry = {
      ...sourceWithoutTags,
      ...(tags.length ? { tags } : {}),
    };
    const namespace = source.namespace ?? inferCacheNamespace(key, source.body);
    const entry: CacheEntry = {
      ...normalizedSource,
      namespace,
      weightBytes: this.entryWeight(key, normalizedSource),
    };
    return this.admit(key, entry);
  }

  async attachMemoryValue(
    key: string,
    value: unknown,
    valueBytes: number,
    namespace: CacheNamespace,
  ): Promise<boolean> {
    const current = this.store.get(key);
    if (!current || current.namespace !== namespace) return false;
    const safeValueBytes =
      Number.isFinite(valueBytes) && valueBytes >= 0 ? valueBytes : Number.POSITIVE_INFINITY;
    return this.admit(key, {
      ...current,
      memoryValue: value,
      memoryValueBytes: safeValueBytes,
      weightBytes: this.entryWeight(key, { ...current, memoryValueBytes: safeValueBytes }),
    });
  }

  /** Synchronous L1 flush for invalidation subscriber reconnect safety. */
  flushAllSync(): number {
    const deleted = this.store.size;
    this.store.clear();
    this.tagIndex.clear();
    this.resetUsage();
    return deleted;
  }

  async deleteKey(key: string): Promise<boolean> {
    return this.removeEntry(key);
  }

  async deleteKeys(keys: string[]): Promise<number> {
    return this.deleteKeysReturningNames(keys).length;
  }

  /** Same as deleteKeys, but reports which keys actually existed — used by
   * TieredStore to compute an exact L1∪L2 union instead of guessing from counts. */
  deleteKeysReturningNames(keys: string[]): string[] {
    const deleted: string[] = [];
    for (const key of keys) if (this.removeEntry(key)) deleted.push(key);
    return deleted;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    return this.deleteByPrefixReturningNames(prefix).length;
  }

  deleteByPrefixReturningNames(prefix: string): string[] {
    const deleted: string[] = [];
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix) && this.removeEntry(key)) deleted.push(key);
    }
    return deleted;
  }

  async keysByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult> {
    const normalized = normalizeTagOperation(tags);
    const selected = new Set<string>();
    let truncated = false;
    for (const tag of normalized) {
      for (const key of this.tagIndex.get(tag) ?? []) {
        if (selected.has(key)) continue;
        if (selected.size >= limit) {
          truncated = true;
          break;
        }
        selected.add(key);
      }
      if (truncated) break;
    }
    return { keys: [...selected], truncated };
  }

  async deleteByTags(tags: readonly string[], limit: number): Promise<TagInvalidationResult> {
    const result = await this.keysByTags(tags, limit);
    return { keys: this.deleteKeysReturningNames(result.keys), truncated: result.truncated };
  }

  async flushAll(): Promise<number> {
    return this.flushAllReturningNames().length;
  }

  flushAllReturningNames(): string[] {
    const deleted = [...this.store.keys()];
    this.store.clear();
    this.tagIndex.clear();
    this.resetUsage();
    return deleted;
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
    const offset = Number(options.cursor ?? 0);
    const candidates = options.tag
      ? [...(this.tagIndex.get(options.tag) ?? [])]
      : [...this.store.keys()];
    const filtered = candidates.filter((key) =>
      options.prefix ? key.startsWith(options.prefix) : true,
    );
    const keys = filtered.slice(offset, offset + options.limit);
    const nextOffset = offset + options.limit;
    return {
      keys,
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async readEphemeral(key: string): Promise<string | null> {
    const entry = this.ephemeral.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.ephemeral.delete(key);
      return null;
    }
    return entry.value;
  }

  async writeEphemeral(key: string, value: string, ttlMs: number): Promise<void> {
    if (
      !this.ephemeral.has(key) &&
      this.ephemeral.size >= this.options.auxiliary.maxEphemeralValues
    ) {
      this.cleanupExpiredEphemeral(Date.now());
    }
    if (
      !this.ephemeral.has(key) &&
      this.ephemeral.size >= this.options.auxiliary.maxEphemeralValues
    ) {
      const oldest = this.ephemeral.keys().next().value;
      if (oldest !== undefined) this.ephemeral.delete(oldest);
    }
    this.ephemeral.delete(key);
    const expiresAt = Date.now() + ttlMs;
    this.ephemeral.set(key, { value, expiresAt });
    this.scheduleCleanup(expiresAt);
  }

  async takeRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = this.rateLimits.get(key);
    if (entry && entry.resetAt <= now) {
      this.rateLimits.delete(key);
      entry = undefined;
    }
    if (!entry && this.rateLimits.size >= this.options.auxiliary.maxRateLimits) {
      this.cleanupExpiredRateLimits(now);
    }
    if (!entry && this.rateLimits.size >= this.options.auxiliary.maxRateLimits) {
      return { allowed: false, retryAfterMs: Math.max(1, windowMs) };
    }
    if (!entry || entry.resetAt <= now) {
      entry = { used: 0, resetAt: now + windowMs };
      this.rateLimits.set(key, entry);
    }
    entry.used++;
    this.scheduleCleanup(entry.resetAt);
    return {
      allowed: entry.used <= limit,
      retryAfterMs: Math.max(1, entry.resetAt - now),
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    let current = this.locks.get(key);
    if (current && current.expiresAt <= now) {
      this.locks.delete(key);
      current = undefined;
    }
    if (current && current.expiresAt > now) return null;
    if (!current && this.locks.size >= this.options.auxiliary.maxLocks) {
      this.cleanupExpiredLocks(now);
    }
    if (!current && this.locks.size >= this.options.auxiliary.maxLocks) return null;
    const token = crypto.randomUUID();
    const expiresAt = now + ttlMs;
    this.locks.set(key, { token, expiresAt });
    this.scheduleCleanup(expiresAt);
    return token;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    if (this.locks.get(key)?.token === token) {
      this.locks.delete(key);
    }
  }

  /**
   * The same map. A process-local store has one release and one party, so the
   * distinction the Redis store draws between cache and coordination keys has
   * nothing to separate here.
   */
  acquireCoordinationLock(key: string, ttlMs: number): Promise<string | null> {
    return this.acquireLock(`coordination:${key}`, ttlMs);
  }

  releaseCoordinationLock(key: string, token: string): Promise<void> {
    return this.releaseLock(`coordination:${key}`, token);
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.cleanupDeadline = undefined;
    this.store.clear();
    this.tagIndex.clear();
    this.locks.clear();
    this.ephemeral.clear();
    this.rateLimits.clear();
    this.resetUsage();
  }

  private admit(key: string, entry: CacheEntry): boolean {
    const namespace = entry.namespace!;
    const weight = entry.weightBytes!;
    const budget = this.options.namespaces[namespace];
    if (weight > this.options.maxBytes) return this.reject(namespace, "entry_too_large");
    if (weight > budget.maxBytes) return this.reject(namespace, "namespace_budget");

    const existing = this.store.get(key);
    if (!this.canIndexTags(key, entry, existing)) {
      return this.reject(namespace, "tag_cardinality");
    }
    const projected = new Map<CacheNamespace, number>();
    for (const candidate of CACHE_NAMESPACES) {
      projected.set(candidate, this.usageFor(candidate).bytes);
    }
    let projectedTotal = this.totalBytes;
    let projectedEntries = this.store.size;
    if (existing) {
      const existingNamespace = existing.namespace!;
      const existingWeight = existing.weightBytes!;
      projected.set(existingNamespace, projected.get(existingNamespace)! - existingWeight);
      projectedTotal -= existingWeight;
    } else {
      projectedEntries++;
    }
    projected.set(namespace, projected.get(namespace)! + weight);
    projectedTotal += weight;

    const selected = new Map<string, EvictionReason>();
    const select = (candidateKey: string, candidate: CacheEntry, reason: EvictionReason): void => {
      if (selected.has(candidateKey)) return;
      selected.set(candidateKey, reason);
      projected.set(
        candidate.namespace!,
        projected.get(candidate.namespace!)! - candidate.weightBytes!,
      );
      projectedTotal -= candidate.weightBytes!;
      projectedEntries--;
    };

    for (const [candidateKey, candidate] of this.store) {
      if (projected.get(namespace)! <= budget.maxBytes) break;
      if (candidateKey !== key && candidate.namespace === namespace) {
        select(candidateKey, candidate, "namespace_budget");
      }
    }
    if (projected.get(namespace)! > budget.maxBytes) {
      return this.reject(namespace, "namespace_budget");
    }

    for (const [candidateKey, candidate] of this.store) {
      if (projectedTotal <= this.options.maxBytes) break;
      if (candidateKey === key || selected.has(candidateKey)) continue;
      const candidateNamespace = candidate.namespace!;
      if (
        projected.get(candidateNamespace)! - candidate.weightBytes! >=
        this.options.namespaces[candidateNamespace].reserveBytes
      ) {
        select(candidateKey, candidate, "global_budget");
      }
    }
    if (projectedTotal > this.options.maxBytes) {
      return this.reject(namespace, "reserved_capacity");
    }

    for (const [candidateKey, candidate] of this.store) {
      if (projectedEntries <= this.maxEntries) break;
      if (candidateKey === key || selected.has(candidateKey)) continue;
      const candidateNamespace = candidate.namespace!;
      if (
        projected.get(candidateNamespace)! - candidate.weightBytes! >=
        this.options.namespaces[candidateNamespace].reserveBytes
      ) {
        select(candidateKey, candidate, "entry_limit");
      }
    }
    if (projectedEntries > this.maxEntries) return this.reject(namespace, "entry_limit");

    if (existing) this.removeEntry(key);
    for (const [candidateKey, reason] of selected) this.removeEntry(candidateKey, reason);
    this.store.set(key, entry);
    this.addTagIndex(key, entry);
    this.addUsage(entry);
    this.scheduleCleanup(entry.staleUntil);
    return true;
  }

  private reject(namespace: CacheNamespace, reason: RejectionReason): false {
    observeL1CacheRejection(namespace, reason);
    return false;
  }

  private removeEntry(key: string, reason?: EvictionReason): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    this.store.delete(key);
    this.removeTagIndex(key, entry);
    const namespace = entry.namespace!;
    const usage = this.usageFor(namespace);
    usage.bytes = Math.max(0, usage.bytes - entry.weightBytes!);
    usage.entries = Math.max(0, usage.entries - 1);
    this.totalBytes = Math.max(0, this.totalBytes - entry.weightBytes!);
    setL1CacheState(namespace, usage.bytes, usage.entries);
    if (reason) observeL1CacheEviction(namespace, reason);
    return true;
  }

  private addUsage(entry: CacheEntry): void {
    const namespace = entry.namespace!;
    const usage = this.usageFor(namespace);
    usage.bytes += entry.weightBytes!;
    usage.entries++;
    this.totalBytes += entry.weightBytes!;
    setL1CacheState(namespace, usage.bytes, usage.entries);
  }

  private resetUsage(): void {
    this.totalBytes = 0;
    for (const namespace of CACHE_NAMESPACES) {
      const usage = this.usageFor(namespace);
      usage.bytes = 0;
      usage.entries = 0;
      setL1CacheState(namespace, 0, 0);
    }
  }

  private usageFor(namespace: CacheNamespace): NamespaceUsage {
    return this.usage.get(namespace)!;
  }

  private entryWeight(key: string, entry: CacheEntry): number {
    const markerBytes = cacheEntryFragmentMarkers(entry).reduce(
      (sum, marker) => sum + Buffer.byteLength(marker.name, "utf8") + 32,
      0,
    );
    const memoryValueBytes =
      entry.memoryValueBytes === undefined
        ? 0
        : Number.isFinite(entry.memoryValueBytes) && entry.memoryValueBytes >= 0
          ? entry.memoryValueBytes
          : Number.POSITIVE_INFINITY;
    const tagBytes = (entry.tags ?? []).reduce(
      (sum, tag) => sum + Buffer.byteLength(tag, "utf8") + Buffer.byteLength(key, "utf8") + 64,
      0,
    );
    return (
      Buffer.byteLength(key, "utf8") +
      Buffer.byteLength(entry.body, "utf8") +
      markerBytes +
      tagBytes +
      memoryValueBytes +
      192
    );
  }

  private canIndexTags(key: string, entry: CacheEntry, existing?: CacheEntry): boolean {
    const existingTags = new Set(existing?.tags ?? []);
    let newTagCount = 0;
    for (const tag of entry.tags ?? []) {
      const indexed = this.tagIndex.get(tag);
      if (!indexed) newTagCount++;
      if (!indexed?.has(key) && (indexed?.size ?? 0) >= MAX_TAG_KEYS) return false;
    }
    for (const tag of existingTags) {
      if ((entry.tags ?? []).includes(tag)) continue;
      if (this.tagIndex.get(tag)?.size === 1) newTagCount--;
    }
    return this.tagIndex.size + newTagCount <= MAX_INDEXED_TAGS;
  }

  private addTagIndex(key: string, entry: CacheEntry): void {
    for (const tag of entry.tags ?? []) {
      const keys = this.tagIndex.get(tag) ?? new Set<string>();
      keys.add(key);
      this.tagIndex.set(tag, keys);
    }
  }

  private removeTagIndex(key: string, entry: CacheEntry): void {
    for (const tag of entry.tags ?? []) {
      const keys = this.tagIndex.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) this.tagIndex.delete(tag);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.staleUntil <= now) this.removeEntry(key, "expired");
    }
    this.cleanupExpiredAuxiliary(now);
  }

  private cleanupExpiredAuxiliary(now: number): void {
    this.cleanupExpiredLocks(now);
    this.cleanupExpiredEphemeral(now);
    this.cleanupExpiredRateLimits(now);
  }

  private cleanupExpiredLocks(now: number): void {
    for (const [key, entry] of this.locks) if (entry.expiresAt <= now) this.locks.delete(key);
  }

  private cleanupExpiredEphemeral(now: number): void {
    for (const [key, entry] of this.ephemeral)
      if (entry.expiresAt <= now) this.ephemeral.delete(key);
  }

  private cleanupExpiredRateLimits(now: number): void {
    for (const [key, entry] of this.rateLimits)
      if (entry.resetAt <= now) this.rateLimits.delete(key);
  }

  private scheduleCleanup(deadline?: number): void {
    if (deadline === undefined) return;
    if (
      this.cleanupTimer &&
      this.cleanupDeadline !== undefined &&
      this.cleanupDeadline <= deadline
    ) {
      return;
    }
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupDeadline = deadline;
    const delay = Math.max(1, deadline - Date.now());
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      this.cleanupDeadline = undefined;
      this.cleanupExpired();
      this.scheduleCleanup(this.nextCleanupDeadline());
    }, delay);
    this.cleanupTimer.unref?.();
  }

  private nextCleanupDeadline(): number | undefined {
    let deadline: number | undefined;
    const consider = (value: number): void => {
      if (deadline === undefined || value < deadline) deadline = value;
    };
    for (const entry of this.store.values()) consider(entry.staleUntil);
    for (const entry of this.locks.values()) consider(entry.expiresAt);
    for (const entry of this.ephemeral.values()) consider(entry.expiresAt);
    for (const entry of this.rateLimits.values()) consider(entry.resetAt);
    return deadline;
  }
}

export function memorySize(store: MemoryStore): number {
  return store.size;
}
