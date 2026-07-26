import { mergeSearchParams } from "@originloom/shared/routing";
import { describe, expect, it } from "vitest";

describe("routing query merge", () => {
  it("preserves incoming values and lets destination values win by key", () => {
    const incoming = new URLSearchParams("q=kredi&source=incoming&tag=one&tag=two");
    const destination = new URLSearchParams("source=legacy&tag=configured&tag=secondary");

    expect(mergeSearchParams(incoming, destination)).toBe(
      "q=kredi&source=legacy&tag=configured&tag=secondary",
    );
  });

  it("does not mutate either source collection", () => {
    const incoming = new URLSearchParams("q=kredi");
    const destination = new URLSearchParams("source=legacy");

    mergeSearchParams(incoming, destination);

    expect(incoming.toString()).toBe("q=kredi");
    expect(destination.toString()).toBe("source=legacy");
  });
});
