import { beforeEach } from "vitest";

// Install the product runtime before each test, resolving it dynamically so the
// modules come from the test file's own graph (vi.mock substitutions included).
// An eager import here would create a second, unmocked module graph and split
// singletons like the cache store between setup and test imports.
beforeEach(async () => {
  const [{ productRuntime }, { installRuntime }] = await Promise.all([
    import("@server/product/runtime"),
    import("@server/runtime"),
  ]);
  installRuntime(productRuntime);
});
