import { type AppVariables, normalizeRequestId, requestId } from "@server/middleware/request-id";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("request id", () => {
  it("keeps a bounded safe upstream id", () => {
    expect(normalizeRequestId("edge_01:request-2")).toBe("edge_01:request-2");
  });

  it("replaces unsafe or oversized ids", () => {
    expect(normalizeRequestId("line\nbreak")).toMatch(/^[0-9a-f-]{36}$/);
    expect(normalizeRequestId("x".repeat(129))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("adds the id to a response replaced by a downstream handler", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requestId);
    app.get("/", () => new Response("ok"));

    const response = await app.request("/", { headers: { "x-request-id": "upstream-42" } });

    expect(response.headers.get("x-request-id")).toBe("upstream-42");
  });

  it("adds the id to immutable redirect responses", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requestId);
    app.get("/", () => Response.redirect("http://localhost/next", 307));

    const response = await app.request("/", { redirect: "manual" });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/next");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
