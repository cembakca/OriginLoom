/**
 * Marks data that must never reach the browser.
 *
 * The rule this enforces is the one the cache architecture rests on: rendered
 * HTML is shared by every visitor, so anything belonging to one of them cannot
 * be in it. Today that rule is held up by types and by tests that know where to
 * look — both of which a new loader can walk past without noticing. Tainting
 * moves the check to the boundary itself: the moment a marked object or value
 * is serialized into the document, serialization fails.
 *
 * **This is a second line, not the first.** Filter in the loader; a taint only
 * catches what got through. It is also defeated by copying — `{...user}` and
 * `{ name: user.name }` are new objects that carry none of the mark. Taint the
 * values that matter (`taintValue`) when the shape may be reassembled.
 */

/** Object references that must not be serialized, and why. */
const taintedObjects = new WeakMap<object, string>();

/** Exact strings that must not be serialized, and why. */
const taintedValues = new Map<string, string>();

/**
 * Drops a value's entry once whatever owned it is collected.
 *
 * Without this the registry would hold every session token the process ever
 * saw, which turns a leak guard into a leak. The lifetime object is normally
 * the record the value came from.
 */
const valueLifetimes = new FinalizationRegistry<string>((value) => {
  taintedValues.delete(value);
});

/** Short strings collide with ordinary content, so they are refused outright. */
const MIN_TAINTABLE_LENGTH = 8;

/**
 * Ceiling on remembered value marks.
 *
 * `FinalizationRegistry` releases an entry when its lifetime object is
 * collected, but it makes no promise about *when* — so a busy process could
 * accumulate marks faster than GC retires them, and a guard against leaking
 * data would itself become the leak. The map is insertion-ordered, so passing
 * the ceiling drops the oldest mark first: the value least likely to be the one
 * currently being serialized.
 */
const MAX_TAINTED_VALUES = 2_048;

export class TaintedValueError extends Error {
  constructor(
    readonly reason: string,
    readonly where: string,
  ) {
    super(`Refusing to serialize tainted data into ${where}: ${reason}`);
    this.name = "TaintedValueError";
  }
}

/**
 * Marks an object — a profile, a session, a gateway response — as
 * server-only.
 *
 * `reason` is shown to whoever trips the guard, so write it for them: say what
 * the data is and where the safe copy comes from.
 */
export function taintObject<T extends object>(reason: string, object: T): T {
  taintedObjects.set(object, reason);
  taintedObjectCount += 1;
  return object;
}

/**
 * Marks one exact string — a token, an id — as server-only.
 *
 * `lifetime` decides how long the mark is remembered: pass the object the value
 * belongs to, and the entry disappears when that object does. Values shorter
 * than eight characters are rejected, because marking `"1"` or `"tr"` would
 * make every document containing that string unserializable.
 */
export function taintValue(reason: string, lifetime: object, value: string): void {
  if (value.length < MIN_TAINTABLE_LENGTH) {
    throw new TypeError(
      `taintValue needs at least ${MIN_TAINTABLE_LENGTH} characters; a short value would match unrelated content`,
    );
  }

  if (!taintedValues.has(value) && taintedValues.size >= MAX_TAINTED_VALUES) {
    const oldest = taintedValues.keys().next();
    if (!oldest.done) taintedValues.delete(oldest.value);
  }

  taintedValues.set(value, reason);
  valueLifetimes.register(lifetime, value);
}

/**
 * Marks a value only if it can be marked, for callers on a hot path that hold
 * something which may or may not be a credential.
 *
 * `taintValue` throws on a value too short to distinguish, which is right when
 * a developer names a constant by mistake and wrong when the input is a cookie
 * a browser sent — there, a malformed value must not take the request down.
 */
export function taintValueIfPossible(reason: string, lifetime: object, value: string): void {
  if (value.length < MIN_TAINTABLE_LENGTH) return;
  taintValue(reason, lifetime, value);
}

/**
 * A `WeakMap` cannot be counted, so object marks are tallied separately. The
 * tally only ever grows: a collected object leaves it high, which costs one
 * cheap walk and never a missed check.
 */
let taintedObjectCount = 0;

/** Whether anything is marked at all — lets callers skip the walk entirely. */
export function hasTaintedData(): boolean {
  return taintedValues.size > 0 || taintedObjectCount > 0;
}

/** Throws when `value` is marked. Cheap; called per node during serialization. */
export function assertNodeUntainted(value: unknown, where: string): void {
  if (typeof value === "string") {
    const reason = taintedValues.get(value);
    if (reason) throw new TaintedValueError(reason, where);
    return;
  }
  if (value !== null && typeof value === "object") {
    const reason = taintedObjects.get(value);
    if (reason) throw new TaintedValueError(reason, where);
  }
}

/**
 * Throws when rendered HTML contains a marked value, before it is shared.
 *
 * `assertNodeUntainted` walks structured data and catches a credential on its
 * way into island props. It cannot see the other route, which is the one this
 * item is named after: a personal string rendered as *text*, into HTML that a
 * shared cache is about to store and serve to everyone.
 *
 * By that point the objects are gone and there is nothing to walk — but the
 * strings are still strings, and a marked one is long enough to search for
 * (`MIN_TAINTABLE_LENGTH` exists for exactly this reason: `"1"` would match
 * every document). So this is a substring scan, run once per shared cache write
 * and skipped entirely when nothing is marked.
 *
 * It is a second line, not the first. The first is not rendering personal data
 * into shared HTML at all; this is what says so out loud when someone does.
 */
export function assertHtmlUntainted(html: string, where: string): void {
  if (taintedValues.size === 0) return;
  for (const [value, reason] of taintedValues) {
    if (html.includes(value)) throw new TaintedValueError(reason, where);
  }
}

/** Test-only: forgets every mark so one case cannot leak into the next. */
export function clearTaintRegistryForTests(): void {
  taintedValues.clear();
  taintedObjectCount = 0;
}
