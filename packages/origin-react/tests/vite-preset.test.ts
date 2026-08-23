import { describe, expect, it } from "vitest";

import { createClientViteConfig, createServerViteConfig } from "../src/vite/preset.js";

const entry = "/app/src/entry.client.tsx";

describe("client Vite config", () => {
  const config = createClientViteConfig({ entry });

  it("pre-bundles the React runtime the excluded packages import", () => {
    // @originloom/react is excluded from the optimizer, so Vite serves its
    // imports raw. react-dom/client is CJS: without this, the browser receives a
    // module with no `createRoot` export and no island ever mounts.
    expect(config.optimizeDeps?.exclude).toContain("@originloom/react");
    expect(config.optimizeDeps?.include).toEqual(
      expect.arrayContaining(["react", "react-dom", "react-dom/client", "react/jsx-runtime"]),
    );
  });

  it("keeps a single copy of the React runtime", () => {
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(["react", "react-dom"]));
  });

  it("gives the app its own dev-server port when asked", () => {
    const scoped = createClientViteConfig({ entry, devServer: { port: 5020 } });
    expect(scoped.server?.port).toBe(5020);
    expect(scoped.server?.strictPort).toBe(true);
  });
});

describe("server Vite config", () => {
  it("inlines the workspace packages so the bundle is self-contained", () => {
    const config = createServerViteConfig({ entry: "/app/server/index.ts" });
    expect(config.ssr?.noExternal).toEqual([/^@originloom\//]);
    // Tracks the engines floor — see packages/origin-shared/src/vite.ts.
    expect(config.build?.target).toBe("node24");
    expect(config.build?.minify).toBe("esbuild");
    expect(config.esbuild).toMatchObject({ keepNames: true });
  });
});
