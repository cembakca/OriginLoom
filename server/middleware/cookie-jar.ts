import type { CookieOptions } from "./types";

type Entry = { value: string; options: CookieOptions };

/** Accumulates Set-Cookie headers across pipeline steps. */
export class CookieJar {
  private entries = new Map<string, Entry>();

  set(name: string, value: string, options: CookieOptions = {}): void {
    this.entries.set(name, {
      value,
      options: { path: "/", sameSite: "lax", ...options },
    });
  }

  delete(name: string): void {
    this.entries.set(name, {
      value: "",
      options: { path: "/", maxAge: 0 },
    });
  }

  toHeaderStrings(): string[] {
    return [...this.entries.entries()].map(([name, { value, options }]) => {
      const parts = [`${name}=${encodeURIComponent(value)}`];
      if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
      if (options.path) parts.push(`Path=${options.path}`);
      if (options.httpOnly) parts.push("HttpOnly");
      if (options.secure) parts.push("Secure");
      if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
      return parts.join("; ");
    });
  }

  merge(other: CookieJar): void {
    for (const [name, entry] of other.entries) {
      this.entries.set(name, entry);
    }
  }
}

export function applyCookies(response: Response, jar: CookieJar): Response {
  const headers = new Headers(response.headers);
  const cookies = jar.toHeaderStrings();
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  // A response that mutates session or tracking state must never be stored by a
  // browser or intermediary, regardless of the cache policy set before the
  // middleware pipeline finalized the response.
  if (cookies.length > 0) headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function mergeResponseHeaders(response: Response, extra: Headers): Response {
  const headers = new Headers(response.headers);
  extra.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
