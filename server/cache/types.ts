import type { CachePolicy } from "~/lib/types";

export type CacheEntry = { body: string; freshUntil: number; staleUntil: number };

export type ListKeysOptions = {
  prefix?: string;
  limit: number;
  cursor?: string;
};

export type ListKeysResult = {
  keys: string[];
  nextCursor?: string;
};

export interface CacheStore {
  read(key: string): Promise<{ body: string; state: "fresh" | "stale" } | null>;
  write(key: string, body: string, policy: CachePolicy): Promise<void>;
  deleteKey(key: string): Promise<boolean>;
  deleteKeys(keys: string[]): Promise<number>;
  deleteByPrefix(prefix: string): Promise<number>;
  flushAll(): Promise<number>;
  listKeys(options: ListKeysOptions): Promise<ListKeysResult>;
  ping?(): Promise<boolean>;
  close?(): Promise<void>;
}
