import { Cookie, HOST_PREFIX } from "@originloom/shared/lib/cookies";
import { sessionCookie } from "@originloom/shared/lib/request";
import { afterEach, describe, expect, it } from "vitest";

import { CookieJar } from "../src/middleware/cookie-jar.js";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

function jarIn(mode: string): CookieJar {
  process.env.NODE_ENV = mode;
  return new CookieJar();
}

function requestWith(cookieHeader: string): Request {
  return new Request("https://example.com/", { headers: { cookie: cookieHeader } });
}

describe("__Host- prefix", () => {
  it("prefixes a session cookie in production", () => {
    const jar = jarIn("production");
    jar.set(Cookie.signedIn, "1", { maxAge: 60 });

    const [header] = jar.toHeaderStrings();
    expect(header).toContain(`${HOST_PREFIX}${Cookie.signedIn}=1`);
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
  });

  /**
   * The prefix is only valid on a `Secure` cookie, and development is not
   * secure. A prefixed cookie there would be dropped by the browser without a
   * word, which is the worst of both worlds: no security and no session.
   */
  it("uses the plain name where nothing is Secure", () => {
    const jar = jarIn("development");
    jar.set(Cookie.signedIn, "1", { maxAge: 60 });

    expect(jar.toHeaderStrings()[0]).toContain(`${Cookie.signedIn}=1`);
    expect(jar.toHeaderStrings()[0]).not.toContain(HOST_PREFIX);
  });

  /**
   * `__Host-` forbids `Domain`, so an attribution cookie a product wants shared
   * across subdomains cannot carry it. Breaking that sharing to look strict
   * would be the worse trade.
   */
  it("leaves a cookie outside the set alone", () => {
    const jar = jarIn("production");
    jar.set(Cookie.utmSource, "newsletter", { maxAge: 60 });

    expect(jar.toHeaderStrings()[0]).not.toContain(HOST_PREFIX);
  });

  it("does not prefix a cookie scoped to a sub-path", () => {
    const jar = jarIn("production");
    jar.set(Cookie.signedIn, "1", { path: "/hesabim" });

    expect(jar.toHeaderStrings()[0]).not.toContain(HOST_PREFIX);
  });
});

describe("reading during the migration", () => {
  it("prefers the prefixed cookie", () => {
    const request = requestWith(`${HOST_PREFIX}${Cookie.signedIn}=new; ${Cookie.signedIn}=old`);
    expect(sessionCookie(request, Cookie.signedIn)).toBe("new");
  });

  /** The middle of the rollout: the visitor still holds only the old name. */
  it("still reads the unprefixed cookie", () => {
    expect(sessionCookie(requestWith(`${Cookie.signedIn}=old`), Cookie.signedIn)).toBe("old");
  });

  it("reads a cookie that was never prefixed", () => {
    const request = requestWith(`${Cookie.utmSource}=newsletter`);
    expect(sessionCookie(request, Cookie.utmSource)).toBe("newsletter");
  });

  it("returns nothing when neither name is present", () => {
    expect(sessionCookie(requestWith("theme=dark"), Cookie.signedIn)).toBeUndefined();
  });
});

describe("signing out during the migration", () => {
  /**
   * The bug this would have been. A visitor who signed in before the rollout
   * holds the unprefixed cookie; clearing only the prefixed name would leave
   * their refresh token in the browser after they pressed sign out — and a
   * sign-out that leaves the credential behind does not look like a failure
   * anywhere.
   */
  it("expires both names", () => {
    const jar = jarIn("production");
    jar.delete(Cookie.refreshToken);

    const headers = jar.toHeaderStrings();
    expect(headers).toHaveLength(2);
    expect(headers.some((h) => h.startsWith(`${HOST_PREFIX}${Cookie.refreshToken}=;`))).toBe(true);
    expect(headers.some((h) => h.startsWith(`${Cookie.refreshToken}=;`))).toBe(true);
    for (const header of headers) expect(header).toContain("Max-Age=0");
  });

  it("expires one name for a cookie that was never prefixed", () => {
    const jar = jarIn("production");
    jar.delete(Cookie.utmSource);

    expect(jar.toHeaderStrings()).toHaveLength(1);
  });

  /** Nothing is prefixed in development, so there is only ever one name there. */
  it("expires one name in development", () => {
    const jar = jarIn("development");
    jar.delete(Cookie.refreshToken);

    expect(jar.toHeaderStrings()).toHaveLength(1);
  });
});
