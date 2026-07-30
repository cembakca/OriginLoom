import { decodeCacheEntry, encodeCacheEntry } from "@originloom/core/cache/codec";
import type { CacheEntry } from "@originloom/core/cache/types";
import { findSsrFragmentMarkers } from "@originloom/shared/fragment-markup";
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
    const entry: CacheEntry = { body, hasFragments: false, fragmentMarkers: [], ...timestamps };

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

    expect(decodeCacheEntry(Buffer.from(JSON.stringify(legacy), "utf8"))).toEqual({
      ...legacy,
      hasFragments: false,
      fragmentMarkers: [],
    });
  });

  it("derives fragment metadata when reading a version 1 binary entry", () => {
    const body =
      '<!DOCTYPE html><ssr-fragment name="account" style="display: contents">fallback</ssr-fragment>';
    const versionOne = withoutVersionThreeMetadata(encodeCacheEntry({ body, ...timestamps }));
    versionOne.writeUInt8(1, 4);

    expect(decodeCacheEntry(versionOne)).toEqual({
      body,
      ...timestamps,
      hasFragments: true,
      fragmentMarkers: findSsrFragmentMarkers(body),
    });
  });

  it("reads version 2 fragment-flag entries during a rolling deployment", () => {
    const body =
      '<!DOCTYPE html><ssr-fragment name="menu" style="display: contents">fallback</ssr-fragment>';
    const versionTwo = withoutVersionThreeMetadata(encodeCacheEntry({ body, ...timestamps }));
    versionTwo.writeUInt8(2, 4);

    expect(decodeCacheEntry(versionTwo)).toEqual({
      body,
      ...timestamps,
      hasFragments: true,
      fragmentMarkers: findSsrFragmentMarkers(body),
    });
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

function withoutVersionThreeMetadata(current: Buffer): Buffer {
  const headerBytes = 22;
  const metadataBytes = current.readUInt32BE(headerBytes);
  return Buffer.concat([
    current.subarray(0, headerBytes),
    current.subarray(headerBytes + 4 + metadataBytes),
  ]);
}
