import { closeCache, initCache } from "@server/cache";
import { renderMetrics } from "@server/metrics";
import { buildShellData } from "@server/services/shell-data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ctx } from "~/lib/types";

describe("shell gateway degradation", () => {
  beforeEach(async () => {
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await closeCache();
  });

  it("renders an empty non-critical menu when its contract is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          headerItems: [{ id: 1, name: "Unsafe", url: "javascript:alert(1)" }],
        }),
      ),
    );

    const shell = await buildShellData(context());

    expect(shell.menu).toEqual({ headerItems: [], hamburgerItems: [], footerItems: [] });
    expect(renderMetrics()).toContain(
      'ssr_shell_degraded_total{component="menu",reason="invalid_payload"}',
    );
  });
});

function context(): Ctx {
  const url = new URL("http://localhost/");
  return { request: new Request(url), params: {}, url, publicPath: "/" };
}
