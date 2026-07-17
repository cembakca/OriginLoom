import { publicBodyLimit } from "@server/middleware/public-body-limit";
import type { AppVariables } from "@server/middleware/request-id";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

describe("public body limit", () => {
  it("rejects oversized bodies outside /api routes", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("requestClass", "proxy");
      await next();
    });
    app.use("*", publicBodyLimit(5));
    app.post("/legacy-path", async (c) => c.text(await c.req.text()));

    const response = await app.request("/legacy-path", {
      method: "POST",
      headers: { "content-length": "10" },
      body: "0123456789",
    });

    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload too large");
  });

  it("keeps a machine-readable 413 contract for APIs", async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("requestClass", "api");
      await next();
    });
    app.use("*", publicBodyLimit(5));
    app.post("/api/example", async (c) => c.json({ body: await c.req.text() }));

    const response = await app.request("/api/example", {
      method: "POST",
      headers: { "content-length": "6" },
      body: "123456",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});
