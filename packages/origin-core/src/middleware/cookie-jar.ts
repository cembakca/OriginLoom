export type CookieOptions = {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

type Entry = { value: string; options: CookieOptions };

/** Accumulates Set-Cookie headers across pipeline steps. */
export class CookieJar {
  private entries = new Map<string, Entry>();
  private readonly requireSecure: boolean;

  constructor() {
    // This is deliberately enforced below caller options: product middleware
    // cannot accidentally downgrade a production cookie with `secure: false`.
    this.requireSecure = (process.env.NODE_ENV ?? "development") === "production";
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    this.entries.set(name, {
      value,
      options: this.applySecurityPolicy({ path: "/", sameSite: "lax", ...options }),
    });
  }

  delete(name: string): void {
    this.entries.set(name, {
      value: "",
      options: this.applySecurityPolicy({ path: "/", maxAge: 0 }),
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
      this.entries.set(name, {
        ...entry,
        options: this.applySecurityPolicy(entry.options),
      });
    }
  }

  private applySecurityPolicy(options: CookieOptions): CookieOptions {
    return this.requireSecure ? { ...options, secure: true } : options;
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
