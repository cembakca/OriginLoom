import { decodeCacheEntry, encodeCacheEntry } from "@originloom/core/cache/codec";
import type { CacheEntry } from "@originloom/core/cache/types";
import { describe, expect, it } from "vitest";

const timestamps = {
  freshUntil: 1_800_000_000_000,
  staleUntil: 1_800_000_060_000,
};

describe("Redis cache codec", () => {
  it("uses HTML-tuned compression and restores the document byte-for-byte", () => {
    const body =
      "<!DOCTYPE html><html><head><title>SSR</title></head><body>" +
      '<main class="container"><article>Cacheable content</article></main>'.repeat(200) +
      "</body></html>";
    const entry: CacheEntry = { body, ...timestamps };

    const encoded = encodeCacheEntry(entry);

    expect(encoded.length).toBeLessThan(Buffer.byteLength(body, "utf8") * 0.2);
    expect(decodeCacheEntry(encoded)).toEqual(entry);
  });

  it("keeps small non-HTML cache values raw instead of applying generic compression", () => {
    const body = JSON.stringify({ cities: ["ankara", "izmir"], version: 1 });
    const encoded = encodeCacheEntry({ body, ...timestamps });

    expect(encoded.subarray(-Buffer.byteLength(body)).toString("utf8")).toBe(body);
    expect(decodeCacheEntry(encoded)?.body).toBe(body);
  });

  it("reads legacy JSON entries during the rolling migration", () => {
    const legacy: CacheEntry = { body: "<!DOCTYPE html><p>legacy</p>", ...timestamps };

    expect(decodeCacheEntry(Buffer.from(JSON.stringify(legacy), "utf8"))).toEqual(legacy);
  });

  it("rejects corrupt, unknown and logically invalid entries", () => {
    const encoded = encodeCacheEntry({
      body: "<!DOCTYPE html>" + "<p>content</p>".repeat(200),
      ...timestamps,
    });
    const unknownEncoding = Buffer.from(encoded);
    unknownEncoding.writeUInt8(255, 5);

    expect(decodeCacheEntry(Buffer.from("not-a-cache-entry"))).toBeNull();
    expect(decodeCacheEntry(encoded.subarray(0, 12))).toBeNull();
    expect(decodeCacheEntry(unknownEncoding)).toBeNull();
    expect(
      decodeCacheEntry(
        Buffer.from(
          JSON.stringify({
            body: "invalid",
            freshUntil: timestamps.staleUntil,
            staleUntil: timestamps.freshUntil,
          }),
        ),
      ),
    ).toBeNull();
  });
});
