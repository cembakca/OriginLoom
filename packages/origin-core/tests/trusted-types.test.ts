import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as SecurityModule from "../src/middleware/security.js";

async function headersFor(env: Record<string, string>): Promise<Headers> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const { createSecurityMiddleware }: typeof SecurityModule =
    await import("../src/middleware/security.js");
  const app = new Hono();
  app.use("*", createSecurityMiddleware());
  app.get("/", (c) => c.text("ok"));

  return (await app.request("/")).headers;
}

const original = { ...process.env };

beforeEach(() => {
  process.env.NODE_ENV = "production";
  process.env.SITE_URL = "https://example.test";
});

afterEach(() => {
  for (const key of ["TRUSTED_TYPES", "CSP_ENFORCE", "NODE_ENV", "SITE_URL"]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("Trusted Types rollout", () => {
  it("emits nothing when the feature is off", async () => {
    const headers = await headersFor({ TRUSTED_TYPES: "off", CSP_ENFORCE: "true" });

    expect(headers.get("content-security-policy")).not.toContain("trusted-types");
    expect(headers.get("content-security-policy-report-only")).toBeNull();
  });

  /**
   * The staged rollout. `require-trusted-types-for` breaks every sink that has
   * not been routed through a policy, so it reports first while the rest of the
   * policy stays enforced — report-only never blocks.
   */
  it("reports separately while the main policy stays enforced", async () => {
    const headers = await headersFor({ TRUSTED_TYPES: "report", CSP_ENFORCE: "true" });

    expect(headers.get("content-security-policy")).not.toContain("trusted-types");
    const reportOnly = headers.get("content-security-policy-report-only") ?? "";
    expect(reportOnly).toContain("require-trusted-types-for 'script'");
    expect(reportOnly).toContain("trusted-types originloom");
  });

  it("enforces on the live policy once switched on", async () => {
    const headers = await headersFor({ TRUSTED_TYPES: "enforce", CSP_ENFORCE: "true" });
    const csp = headers.get("content-security-policy") ?? "";

    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("trusted-types originloom");
  });

  /**
   * Only the app's own policy may be created; without the allow-list any script
   * could mint one and hand itself the trust the directive exists to gate.
   */
  it("allow-lists exactly one policy name", async () => {
    const headers = await headersFor({ TRUSTED_TYPES: "enforce", CSP_ENFORCE: "true" });
    const csp = headers.get("content-security-policy") ?? "";

    expect(/trusted-types originloom(;|$)/.test(csp)).toBe(true);
    expect(csp).not.toContain("'allow-duplicates'");
  });

  it("does not emit a second header when the whole policy is already report-only", async () => {
    const headers = await headersFor({ TRUSTED_TYPES: "report", CSP_ENFORCE: "false" });
    const reportOnly = headers.get("content-security-policy-report-only") ?? "";

    expect(reportOnly).toContain("require-trusted-types-for 'script'");
    // The directives ride the existing header rather than duplicating it.
    expect(reportOnly).toContain("default-src");
    expect(headers.get("content-security-policy")).toBeNull();
  });
});
