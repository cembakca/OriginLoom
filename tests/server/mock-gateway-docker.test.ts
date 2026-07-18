import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const dockerfilePath = resolve(process.cwd(), "mock-gw/Dockerfile");

describe("mock gateway Docker image", () => {
  it("copies every runtime module directory into the image", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");

    expect(dockerfile).toContain("COPY data ./data");
    expect(dockerfile).toContain("COPY lib ./lib");
    expect(dockerfile).toContain("COPY routes ./routes");
  });
});
