import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ServerIslandModule from "../src/server-island.js";

const SECRET = "server-island-secret-long-enough";

async function loadServerIsland(): Promise<typeof ServerIslandModule> {
  vi.resetModules();
  return import("../src/server-island.js");
}

let previous: string | undefined;

beforeEach(() => {
  previous = process.env.SERVER_ISLAND_SECRET;
  process.env.SERVER_ISLAND_SECRET = SECRET;
});

afterEach(() => {
  if (previous === undefined) delete process.env.SERVER_ISLAND_SECRET;
  else process.env.SERVER_ISLAND_SECRET = previous;
});

describe("server island payloads", () => {
  it("round-trips the island name and its props", async () => {
    const { signServerIslandPayload, verifyServerIslandPayload } = await loadServerIsland();

    const token = signServerIslandPayload("account-summary", { variant: "compact" });

    expect(verifyServerIslandPayload(token)).toEqual({
      name: "account-summary",
      props: { variant: "compact" },
    });
  });

  /**
   * The reason placeholders are signed at all. Without this the fill endpoint
   * renders any registered island with whatever input a caller invents.
   */
  it("rejects a payload whose props were edited", async () => {
    const { signServerIslandPayload, verifyServerIslandPayload } = await loadServerIsland();
    const token = signServerIslandPayload("account-summary", { variant: "compact" });
    const [body, signature] = token.split(".") as [string, string];

    const forged = Buffer.from(
      JSON.stringify({ name: "account-summary", props: { admin: true } }),
    ).toString("base64url");

    expect(verifyServerIslandPayload(`${forged}.${signature}`)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it("rejects a payload pointed at a different island", async () => {
    const { signServerIslandPayload, verifyServerIslandPayload } = await loadServerIsland();
    const token = signServerIslandPayload("public-banner", null);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const swapped = Buffer.from(JSON.stringify({ name: "admin-panel", props: null })).toString(
      "base64url",
    );

    expect(verifyServerIslandPayload(`${swapped}.${signature}`)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    const { verifyServerIslandPayload } = await loadServerIsland();

    for (const token of ["", ".", "nodot", "a.b", "....."]) {
      expect(verifyServerIslandPayload(token)).toBeNull();
    }
  });

  it("does not verify a token signed with a different secret", async () => {
    const { signServerIslandPayload } = await loadServerIsland();
    const token = signServerIslandPayload("account-summary", null);

    process.env.SERVER_ISLAND_SECRET = "a-completely-different-secret-value";
    const rotated = await loadServerIsland();

    expect(rotated.verifyServerIslandPayload(token)).toBeNull();
  });

  /**
   * Refusing loudly beats rendering a hole nobody can fill — or one anybody
   * can.
   */
  it("refuses to sign when no secret is configured", async () => {
    delete process.env.SERVER_ISLAND_SECRET;
    const { isServerIslandConfigured, signServerIslandPayload, verifyServerIslandPayload } =
      await loadServerIsland();

    expect(isServerIslandConfigured()).toBe(false);
    expect(() => signServerIslandPayload("x", null)).toThrow(/SERVER_ISLAND_SECRET/);
    expect(verifyServerIslandPayload("anything.atall")).toBeNull();
  });

  it("carries props that are absent as null rather than dropping the field", async () => {
    const { signServerIslandPayload, verifyServerIslandPayload } = await loadServerIsland();

    expect(verifyServerIslandPayload(signServerIslandPayload("banner", null))).toEqual({
      name: "banner",
      props: null,
    });
  });
});
