import { HOST_PREFIX, HOST_PREFIXED_COOKIES } from "@originloom/shared/lib/cookies";

export type CookieOptions = {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
};

/** `wire` is the name that goes out; it may carry the `__Host-` prefix. */
type Entry = { value: string; options: CookieOptions; wire: string };

/** RFC 6265 cookie-name: an HTTP token. Notably excludes `;`, `=`, space and controls. */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/**
 * A path may not carry an attribute separator or a control character. The
 * control range is the point of the check, not an accident — hence the disable.
 */
// eslint-disable-next-line no-control-regex
const COOKIE_PATH = /^[^;\u0000-\u001f\u007f]*$/;

/**
 * The value is percent-encoded on the way out, so it cannot introduce an
 * attribute. The name and the path are written verbatim, so they must be
 * checked: a name or path carrying `;` would append attributes of its own —
 * `Domain=`, or a second `Path=` — to a cookie the app believes it scoped.
 *
 * This throws rather than sanitizing. Both values are the app's own, so a bad
 * one is a bug in the caller; quietly rewriting it would hide the bug and
 * quietly dropping the cookie would break a session in a way nobody traces.
 */
function assertWritable(name: string, path: string | undefined): void {
  if (!COOKIE_NAME.test(name)) {
    throw new TypeError(`Unsafe cookie name: ${JSON.stringify(name)}`);
  }
  if (path !== undefined && !COOKIE_PATH.test(path)) {
    throw new TypeError(`Unsafe cookie path for ${name}: ${JSON.stringify(path)}`);
  }
}

/**
 * The name that goes on the wire, prefixed when the browser will accept it.
 *
 * Decided here rather than at each `jar.set`, because the prefix is only valid
 * under conditions this class already owns — `Secure`, `Path=/`, no `Domain` —
 * and a caller that had to remember all three would eventually emit a cookie
 * every browser silently drops. In development, where nothing is `Secure`, the
 * plain name is used and the session keeps working.
 */
/**
 * Both names when the prefixed one is in play, so an expiry reaches whichever
 * the visitor is actually holding.
 */
function clearableNames(name: string, options: CookieOptions): string[] {
  const wire = wireName(name, options);
  return wire === name ? [name] : [wire, name];
}

function wireName(name: string, options: CookieOptions): string {
  if (!HOST_PREFIXED_COOKIES.has(name)) return name;
  if (!options.secure || options.path !== "/") return name;
  return `${HOST_PREFIX}${name}`;
}

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
    const resolved = this.applySecurityPolicy({ path: "/", sameSite: "lax", ...options });
    assertWritable(name, resolved.path);
    const wire = wireName(name, resolved);
    this.entries.set(wire, { value, options: resolved, wire });
  }

  /**
   * Clears a cookie under **every** name it may be sitting under.
   *
   * The prefixed name alone is not enough while the migration is running: a
   * visitor who signed in before the rollout holds the unprefixed cookie, and
   * clearing only `__Host-refresh_token` would leave their actual refresh token
   * in the browser after they pressed sign out. A cookie a sign-out failed to
   * clear is the one bug in this file that would not look like a bug.
   *
   * Emitting an expiry for a cookie the visitor does not have costs one header
   * and does nothing, which is the right price for not having to know.
   */
  delete(name: string): void {
    assertWritable(name, "/");
    const options = this.applySecurityPolicy({ path: "/", maxAge: 0 });
    for (const wire of clearableNames(name, options)) {
      this.entries.set(wire, { value: "", options, wire });
    }
  }

  toHeaderStrings(): string[] {
    return [...this.entries.values()].map(({ value, options, wire }) => {
      const parts = [`${wire}=${encodeURIComponent(value)}`];
      if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
      if (options.path) parts.push(`Path=${options.path}`);
      if (options.httpOnly) parts.push("HttpOnly");
      if (options.secure) parts.push("Secure");
      if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
      return parts.join("; ");
    });
  }

  merge(other: CookieJar): void {
    for (const [wire, entry] of other.entries) {
      const options = this.applySecurityPolicy(entry.options);
      assertWritable(wire, options.path);
      this.entries.set(wire, { ...entry, options });
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
