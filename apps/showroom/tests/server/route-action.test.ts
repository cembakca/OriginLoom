import { createApp } from "@originloom/core/app";
import { closeCache, initCache } from "@originloom/core/cache";
import { config } from "@originloom/core/config";
import { boundedIdempotencyKey, runOnce } from "@originloom/core/idempotency";
import { formValue, IDEMPOTENCY_FIELD, readFormFields } from "@originloom/shared/lib/form";
import type { Route } from "@originloom/shared/lib/types";
import { redirect } from "@originloom/shared/lib/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const assets = { js: "/assets/entry.client.js", css: [], fonts: [] };
const passthroughCapacity = { run: <T>(_signal: AbortSignal, work: () => Promise<T>) => work() };

type Submitted = { email: string; rejected: boolean };

/** A page that is shared on GET and still accepts a submission on POST. */
const signup: Route<{ email: string; rejected: boolean }, unknown, Submitted> = {
  path: "/signup",
  cache: () => ({ kind: "shared", ttl: 60, key: ["signup"] }),
  action: async (ctx) => {
    const fields = await readFormFields(ctx.request);
    const email = formValue(fields, "email");
    if (!email.includes("@")) return { data: { email, rejected: true }, status: 422 };
    return redirect("/signup?durum=ok", 303);
  },
  loader: async (ctx) => ({ data: ctx.action ?? { email: "", rejected: false } }),
  Component: () => null,
  minimalChrome: true,
};

const readOnly: Route = {
  path: "/read-only",
  loader: async () => ({ data: {} }),
  Component: () => null,
  minimalChrome: true,
};

/** A browser stamps the submission with the origin it came from; so does this. */
const SITE_ORIGIN = new URL(config.siteUrl).origin;

function post(path: string, body: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: SITE_ORIGIN,
      ...headers,
    },
    body,
  });
}

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await closeCache();
  await initCache();
  app = createApp({
    assets,
    routes: [signup, readOnly],
    readinessCheck: async () => true,
    capacity: passthroughCapacity,
  });
});

afterEach(async () => {
  await closeCache();
});

describe("route actions", () => {
  it("answers a valid submission with Post/Redirect/Get", async () => {
    const response = await app.request(post("/signup", "email=cem%40example.com"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/signup?durum=ok");
  });

  /**
   * The whole point of rendering rather than redirecting on failure: the visitor
   * keeps what they typed, and the status still says the submission failed.
   */
  it("re-renders the page with the action's result and its status", async () => {
    const response = await app.request(post("/signup", "email=not-an-address"));

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("<!DOCTYPE html>");
  });

  /**
   * A cacheable page that grows a form must not publish one visitor's rejected
   * submission to the next reader. The route does not arrange this — the
   * platform downgrades the policy for any unsafe method.
   */
  it("never caches a submission, on a page that is otherwise shared", async () => {
    const miss = await app.request("http://localhost/signup");
    expect(miss.headers.get("x-cache")).toBe("MISS");
    const hit = await app.request("http://localhost/signup");
    expect(hit.headers.get("x-cache")).toBe("HIT");

    const submitted = await app.request(post("/signup", "email=nope"));

    expect(submitted.headers.get("x-cache")).toBe("BYPASS");
    expect(submitted.headers.get("cache-control")).toBe("private, no-store");

    // And the cached GET is still the empty form, untouched by the submission.
    const after = await app.request("http://localhost/signup");
    expect(after.headers.get("x-cache")).toBe("HIT");
  });

  it("refuses a submission the browser did not send from this site", async () => {
    const response = await app.request(
      post("/signup", "email=cem%40example.com", { origin: "https://evil.example" }),
    );

    expect(response.status).toBe(403);
  });

  /**
   * PRG stops a reload from re-posting. It does nothing about the second click
   * or the retry after a dropped connection, which arrive as separate POSTs —
   * and the key the form carries is the only thing that tells them apart from
   * two real submissions.
   */
  it("runs a keyed submission once, however many times it arrives", async () => {
    let runs = 0;
    const keyed: Route<{ runs: number }, unknown, { runs: number }> = {
      path: "/keyed",
      action: async (ctx) => {
        const fields = await readFormFields(ctx.request);
        const key = boundedIdempotencyKey(formValue(fields, IDEMPOTENCY_FIELD));
        if (!key) return { data: { runs }, status: 400 };
        const once = await runOnce({
          namespace: "test",
          key,
          work: async () => ({ runs: ++runs }),
          serialize: (value) => JSON.stringify(value),
          parse: (raw) => JSON.parse(raw) as { runs: number },
        });
        // The union has no `value` on "in-flight" on purpose: a caller has to
        // decide what a collision means rather than replaying an outcome that
        // does not exist yet.
        if (once.kind === "in-flight") return { data: { runs }, status: 409 };
        return { data: once.value, status: once.kind === "replayed" ? 200 : 201 };
      },
      loader: async (ctx) => ({ data: ctx.action ?? { runs: 0 } }),
      Component: () => null,
      minimalChrome: true,
    };
    const keyedApp = createApp({
      assets,
      routes: [keyed],
      readinessCheck: async () => true,
      capacity: passthroughCapacity,
    });
    const body = `${IDEMPOTENCY_FIELD}=${"k".repeat(32)}`;

    const first = await keyedApp.request(post("/keyed", body));
    const again = await keyedApp.request(post("/keyed", body));

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(runs).toBe(1);
  });

  /** A page with no action should say so, not quietly render and imply success. */
  it("answers 405 on a route that declares no action", async () => {
    const response = await app.request(post("/read-only", "x=1"));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
