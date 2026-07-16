import { getOffers } from "@server/services/offers";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("offers gateway contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a bounded offer fixture", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json([{ id: "offer-1", bank: "Example Bank", rate: 3.25, monthly: 12_500 }]),
        ),
    );

    await expect(loadOffers()).resolves.toEqual([
      { id: "offer-1", bank: "Example Bank", rate: 3.25, monthly: 12_500 },
    ]);
  });

  it.each([
    ["non-finite rate", '[{"id":"1","bank":"Bank","rate":1e400,"monthly":1}]'],
    ["negative monthly", '[{"id":"1","bank":"Bank","rate":1,"monthly":-1}]'],
    ["oversized bank", JSON.stringify([{ id: "1", bank: "x".repeat(121), rate: 1, monthly: 1 }])],
    [
      "excessive collection",
      JSON.stringify(
        Array.from({ length: 101 }, (_, index) => ({
          id: String(index),
          bank: "Bank",
          rate: 1,
          monthly: 1,
        })),
      ),
    ],
  ])("rejects the %s contract mutation", async (_name, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(loadOffers()).rejects.toThrow("Offers gateway returned an invalid payload");
  });

  it("rejects a deterministic mutation-fuzz corpus", async () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let index = 0; index < 40; index++) {
      const mutation = index % 4;
      const offer: Record<string, unknown> = {
        id: `offer-${index}`,
        bank: "Bank",
        rate: Number((random() * 20).toFixed(2)),
        monthly: Math.round(random() * 100_000),
      };
      if (mutation === 0) offer.id = "";
      if (mutation === 1) offer.bank = "x".repeat(121 + Math.floor(random() * 100));
      if (mutation === 2) offer.rate = 101 + random() * 10_000;
      if (mutation === 3) offer.monthly = -1 - random() * 10_000;

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([offer])));
      await expect(loadOffers()).rejects.toThrow("Offers gateway returned an invalid payload");
    }
  });
});

function loadOffers() {
  return getOffers(new Request("http://localhost/offers"), {
    amount: 50_000,
    city: "istanbul",
    device: "Desktop",
  });
}
