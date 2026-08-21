import { decodeCacheEntry, encodeCacheEntry } from "@originloom/core/cache/codec";
import { dynamicHtmlPlaceholders } from "@originloom/core/cache/dynamic-html";
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

  it("preserves dynamic HTML slots through the Redis wire codec", () => {
    const slots = dynamicHtmlPlaceholders();
    const body =
      `<!DOCTYPE html><script nonce="${slots.cspNonce}">run()</script>` +
      `<script type="application/json">{"pageRequestId":"${slots.pageRequestId}"}</script>`;
    const entry: CacheEntry = { body, ...timestamps };

    expect(decodeCacheEntry(encodeCacheEntry(entry))).toMatchObject({ body });
  });

  it("preserves the compiled fragment plan through the current Redis wire codec", () => {
    const body =
      '<!DOCTYPE html><ssr-fragment name="header" style="display: contents">header</ssr-fragment>' +
      '<main><ssr-fragment name="footer" style="display: contents">footer</ssr-fragment></main>';
    const fragmentMarkers = findSsrFragmentMarkers(body);
    const entry: CacheEntry = { body, fragmentMarkers, hasFragments: true, ...timestamps };

    expect(decodeCacheEntry(encodeCacheEntry(entry))).toEqual(entry);
  });

  it("preserves dependency tags through the current Redis wire codec", () => {
    const entry: CacheEntry = {
      body: '{"menu":true}',
      tags: ["page:home", "resource:menu"],
      ...timestamps,
    };

    expect(decodeCacheEntry(encodeCacheEntry(entry))).toEqual({
      ...entry,
      hasFragments: false,
      fragmentMarkers: [],
    });
  });

  it("reads version 3 compiled-marker entries without tags during a rolling deployment", () => {
    const body =
      '<!DOCTYPE html><ssr-fragment name="menu" style="display: contents">fallback</ssr-fragment>';
    const markers = findSsrFragmentMarkers(body);
    const versionThree = asVersionThree(
      encodeCacheEntry({ body, tags: ["resource:menu"], ...timestamps }),
      markers,
    );

    expect(decodeCacheEntry(versionThree)).toEqual({
      body,
      ...timestamps,
      hasFragments: true,
      fragmentMarkers: markers,
    });
  });

  it("rejects HTML entries containing a concrete request id from an older release", () => {
    const unsafe = encodeCacheEntry({
      body: '<!DOCTYPE html><script>{"pageRequestId":"fill-request-id"}</script>',
      ...timestamps,
    });

    expect(decodeCacheEntry(unsafe)).toBeNull();
    expect(
      decodeCacheEntry(
        Buffer.from(
          JSON.stringify({
            body: '<!DOCTYPE html><script>{"pageRequestId":"legacy-request-id"}</script>',
            ...timestamps,
          }),
        ),
      ),
    ).toBeNull();
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

function asVersionThree(
  current: Buffer,
  markers: ReturnType<typeof findSsrFragmentMarkers>,
): Buffer {
  const headerBytes = 22;
  const currentMetadataBytes = current.readUInt32BE(headerBytes);
  const metadata = Buffer.from(
    JSON.stringify(markers.map(({ name, start, end }) => [name, start, end])),
    "utf8",
  );
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(metadata.length);
  const header = Buffer.from(current.subarray(0, headerBytes));
  header.writeUInt8(3, 4);
  return Buffer.concat([
    header,
    length,
    metadata,
    current.subarray(headerBytes + 4 + currentMetadataBytes),
  ]);
}
