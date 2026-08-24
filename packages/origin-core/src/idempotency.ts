import { randomUUID } from "node:crypto";

import {
  acquireCacheLock,
  readCoordinationValue,
  releaseCacheLock,
  writeCoordinationValue,
} from "./cache/index.js";
import { logError } from "./logger.js";
import { observeIdempotency } from "./metrics.js";

/**
 * What happened to a submission that carried a key.
 *
 * `unavailable` is deliberately a state a caller has to see rather than
 * something this module papers over. A guard that quietly does nothing when its
 * store is missing is worse than no guard: the form still says "we will not
 * charge you twice", and now nobody knows it is not true.
 */
export type IdempotentRun<T> =
  | { kind: "fresh"; value: T }
  | { kind: "replayed"; value: T }
  | { kind: "in-flight" }
  | { kind: "unavailable"; value: T };

export type IdempotentOptions<T> = {
  /** Scopes the key to one operation, so two forms cannot collide on one UUID. */
  namespace: string;
  key: string;
  /** How long a completed result stays replayable. */
  ttlMs?: number;
  work: () => Promise<T>;
  /** What to remember. Return null for an outcome that must not be replayed. */
  serialize: (value: T) => string | null;
  parse: (raw: string) => T | null;
};

/** Long enough to cover a double-click, a retry and a reload; short enough to forget. */
const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * Runs a mutation at most once per key.
 *
 * Post/Redirect/Get already stops a reload from re-posting, which is why forms
 * survived without this — but it does nothing about the submissions PRG never
 * sees: the impatient second click, the retry after a connection drops, the
 * proxy that replays a request it thinks was lost. Those arrive as genuinely
 * separate POSTs and the only thing that can tell them apart from two real
 * submissions is a key the client chose.
 *
 * Two records, not one. The lock says "someone is doing this right now" and the
 * value says "someone already did it, here is what happened" — a single flag
 * cannot distinguish those, and treating in-flight as done would replay an
 * outcome that does not exist yet.
 */
export async function runOnce<T>(options: IdempotentOptions<T>): Promise<IdempotentRun<T>> {
  const recordKey = `idempotency:${options.namespace}:${options.key}`;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  const recorded = await replayed(recordKey, options.parse);
  if (recorded !== null) {
    observeIdempotency(options.namespace, "replayed");
    return { kind: "replayed", value: recorded };
  }

  // The lock TTL outlives the record's write, so a crash mid-work expires
  // rather than wedging the key until the record TTL runs out.
  const token = await acquireCacheLock(`${recordKey}:lock`, ttlMs);
  if (token === null) {
    // Someone else holds it. They may have finished between the read above and
    // this line, so look once more before calling it a collision.
    const late = await replayed(recordKey, options.parse);
    if (late !== null) {
      observeIdempotency(options.namespace, "replayed");
      return { kind: "replayed", value: late };
    }
    observeIdempotency(options.namespace, "in_flight");
    return { kind: "in-flight" };
  }

  try {
    const value = await options.work();
    const serialized = options.serialize(value);
    if (serialized === null) {
      // A failure is not an outcome worth replaying: the visitor should be able
      // to fix their input and submit the same form again.
      observeIdempotency(options.namespace, "not_recorded");
      return { kind: "fresh", value };
    }
    const stored = await recordOutcome(recordKey, serialized, ttlMs);
    observeIdempotency(options.namespace, stored ? "fresh" : "unavailable");
    return stored ? { kind: "fresh", value } : { kind: "unavailable", value };
  } finally {
    await releaseCacheLock(`${recordKey}:lock`, token);
  }
}

/**
 * A key a client chose, bounded before it reaches a cache key.
 *
 * Length and alphabet are checked rather than escaped: the value ends up in a
 * storage key, and a key nobody can predict the shape of is a key nobody can
 * purge or reason about. A UUID passes; so does anything else that looks like
 * one, which is what lets a client pick its own scheme.
 */
export function boundedIdempotencyKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null;
}

/** A fresh key for a form to carry, so a re-render is a new submission. */
export function newIdempotencyKey(): string {
  return randomUUID();
}

async function replayed<T>(key: string, parse: (raw: string) => T | null): Promise<T | null> {
  const raw = await readCoordinationValue(key);
  if (raw === null) return null;
  try {
    return parse(raw);
  } catch (error) {
    // A record this release cannot read is a record from another one. Treating
    // it as absent re-runs the work, which is the safe direction: at worst the
    // visitor is charged the cost of a retry the old release already paid.
    logError(error, { msg: "idempotency record unreadable", key });
    return null;
  }
}

async function recordOutcome(key: string, value: string, ttlMs: number): Promise<boolean> {
  await writeCoordinationValue(key, value, ttlMs);
  // `writeCoordinationValue` swallows a missing backend, so the only honest
  // proof that the record exists is reading it back.
  return (await readCoordinationValue(key)) !== null;
}
