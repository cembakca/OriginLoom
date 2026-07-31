import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SERVER_ROOT = new URL("../../server", import.meta.url).pathname;

/**
 * Calls that legitimately have no request behind them, with the reason.
 *
 * `gatewayFetch` is the only way to reach the gateway without identity, so this
 * list is the whole set of upstream calls that do not carry the visitor's
 * tracking id, IP and device.
 */
const IDENTITY_LESS_BY_DESIGN: Record<string, string> = {
  "services/bot-analytics.ts":
    "a background queue flushed after the request is gone; each event carries its own tracking id",
  "services/route-domains.ts": "falls back to a bare call only when refreshed outside a request",
  "services/sitemap.ts": "falls back to a bare call only when built outside a request",
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("gateway identity coverage", () => {
  it("keeps every upstream call identity-carrying unless it is on the list", () => {
    const offenders = sourceFiles(SERVER_ROOT)
      .filter((file) => /\bgatewayFetch\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SERVER_ROOT.length + 1))
      .filter((relative) => !(relative in IDENTITY_LESS_BY_DESIGN));

    // Every backend call must tell the gateway who asked, from where and on
    // what. A new service that reaches for plain `gatewayFetch` either belongs
    // on the list above with a reason, or should be using
    // `gatewayFetchWithIdentity` / `gatewayFetchForRequest`.
    expect(offenders).toEqual([]);
  });
});
