/** Drop keys whose value is undefined — satisfies exactOptionalPropertyTypes at call sites. */
export type StripUndefined<T extends Record<string, unknown>> = {
  [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
};

export function stripUndefined<T extends Record<string, unknown>>(obj: T): StripUndefined<T> {
  const out = {} as StripUndefined<T>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      (out as Record<string, unknown>)[key as string] = value;
    }
  }
  return out;
}
