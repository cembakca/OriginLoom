import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A rotation, as a deployment performs it: the new secret is added everywhere
 * first (both values present), then the old one is removed. Nothing signed
 * before it started may be refused while it is in progress.
 */
async function withSecrets(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return {
    island: await import("../src/server-island.js"),
    preview: await import("../src/preview.js"),
  };
}

const OLD = "island-secret-old-0123456789abcdef";
const NEW = "island-secret-new-fedcba9876543210";

afterEach(() => {
  for (const name of [
    "SERVER_ISLAND_SECRET",
    "SERVER_ISLAND_PREVIOUS_SECRET",
    "PREVIEW_SECRET",
    "PREVIEW_PREVIOUS_SECRET",
  ]) {
    delete process.env[name];
  }
  vi.resetModules();
});

describe("server island props across a rotation", () => {
  it("still renders a placeholder signed before the rotation began", async () => {
    const before = await withSecrets({
      SERVER_ISLAND_SECRET: OLD,
      SERVER_ISLAND_PREVIOUS_SECRET: undefined,
    });
    const token = before.island.signServerIslandPayload("account", { id: 7 });

    const during = await withSecrets({
      SERVER_ISLAND_SECRET: NEW,
      SERVER_ISLAND_PREVIOUS_SECRET: OLD,
    });

    expect(during.island.verifyServerIslandPayload(token)).toEqual({
      name: "account",
      props: { id: 7 },
    });
  });

  /** Once the old secret is dropped, everything it signed is refused — as intended. */
  it("refuses it once the rotation has finished", async () => {
    const before = await withSecrets({
      SERVER_ISLAND_SECRET: OLD,
      SERVER_ISLAND_PREVIOUS_SECRET: undefined,
    });
    const token = before.island.signServerIslandPayload("account", { id: 7 });

    const after = await withSecrets({
      SERVER_ISLAND_SECRET: NEW,
      SERVER_ISLAND_PREVIOUS_SECRET: undefined,
    });

    expect(after.island.verifyServerIslandPayload(token)).toBeNull();
  });
});

describe("preview grants across a rotation", () => {
  it("still admits a cookie signed before the rotation began", async () => {
    const before = await withSecrets({ PREVIEW_SECRET: OLD, PREVIEW_PREVIOUS_SECRET: undefined });
    const grant = before.preview.createPreviewGrant();

    const during = await withSecrets({ PREVIEW_SECRET: NEW, PREVIEW_PREVIOUS_SECRET: OLD });

    const request = new Request("https://example.com/", {
      headers: { cookie: `${during.preview.PREVIEW_COOKIE}=${encodeURIComponent(grant.value)}` },
    });

    expect(during.preview.isPreviewRequest(request)).toBe(true);
  });

  /** The editor's bookmarked enable link carries the old shared secret. */
  it("still accepts the previous enable token", async () => {
    const during = await withSecrets({ PREVIEW_SECRET: NEW, PREVIEW_PREVIOUS_SECRET: OLD });

    expect(during.preview.isValidPreviewToken(OLD)).toBe(true);
    expect(during.preview.isValidPreviewToken(NEW)).toBe(true);
    expect(during.preview.isValidPreviewToken("something-else-entirely")).toBe(false);
  });
});
