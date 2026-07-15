import type { CachePolicy } from "~/lib/types";

import type { CacheEntry, CacheStore, ListKeysOptions, ListKeysResult } from "./types";

export class MemoryStore implements CacheStore {
  private store = new Map<string, CacheEntry>();

  constructor(private maxEntries: number) {}

  async read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now < entry.freshUntil) return { body: entry.body, state: "fresh" };
    if (now < entry.staleUntil) return { body: entry.body, state: "stale" };

    this.store.delete(key);
    return null;
  }

  async write(key: string, body: string, policy: CachePolicy): Promise<void> {
    if (policy.kind !== "shared") return;
    if (this.store.size >= this.maxEntries) {
      this.store.delete(this.store.keys().next().value!);
    }

    const now = Date.now();
    this.store.set(key, {
      body,
      freshUntil: now + policy.ttl * 1000,
      staleUntil: now + (policy.ttl + (policy.swr ?? 0)) * 1000,
    });
  }

  async deleteKey(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async deleteKeys(keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted++;
    }
    return deleted;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let deleted = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async flushAll(): Promise<number> {
    const deleted = this.store.size;
    this.store.clear();
    return deleted;
  }

  async listKeys(options: ListKeysOptions): Promise<ListKeysResult> {
    const offset = Number(options.cursor ?? 0);
    const filtered = [...this.store.keys()].filter((key) =>
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
}

export function memorySize(store: MemoryStore): number {
  return (store as unknown as { store: Map<string, CacheEntry> }).store.size;
}
