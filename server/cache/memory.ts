import type { CachePolicy } from "~/lib/types";

import type { CacheEntry, CacheStore } from "./types";

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

  async ping(): Promise<boolean> {
    return true;
  }
}

export function memorySize(store: MemoryStore): number {
  return (store as unknown as { store: Map<string, CacheEntry> }).store.size;
}
