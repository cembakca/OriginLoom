import type { CachePolicy } from "~/lib/types";

export type CacheEntry = { body: string; freshUntil: number; staleUntil: number };

export interface CacheStore {
  read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null>;
  write(key: string, body: string, policy: CachePolicy): Promise<void>;
  ping?(): Promise<boolean>;
  close?(): Promise<void>;
}
