import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const WATCH_MEDIA = fileURLToPath(new URL("../bin/watch-media.mjs", import.meta.url));
const scratchDirectories = [];
const children = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * A real watcher, a real debounce and a real image rebuild — seconds of work
 * even when nothing is wrong, and all of it at the mercy of whatever else the
 * test run is doing on the machine. At the 5s default this passed alone and
 * timed out inside the full suite, which is the least useful way for a test to
 * fail: it reports load, not behaviour.
 */
describe("media watch", { timeout: 30_000 }, () => {
  it("rebuilds when a configured visual source changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "originloom-media-watch-"));
    scratchDirectories.push(root);
    mkdirSync(join(root, "server"), { recursive: true });
    mkdirSync(join(root, "src/assets"), { recursive: true });
    writeFileSync(
      join(root, "server/media.config.json"),
      JSON.stringify({
        seoAssets: {
          openGraphSource: "src/assets/brand.svg",
          brandSource: "src/assets/brand.svg",
        },
        images: [],
        fonts: [],
      }),
    );
    const source = join(root, "src/assets/brand.svg");
    writeFileSync(source, svg("#0f172a"));

    const child = spawn(process.execPath, [WATCH_MEDIA], {
      cwd: root,
      env: { ...process.env, ORIGIN_APP_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);

    await waitForOutput(child, "[media:watch] watching");
    writeFileSync(source, svg("#2563eb"));
    await waitForOutput(child, "[media:watch] regenerated (source:brand.svg)");

    expect(existsSync(join(root, "dist/client/assets/media/og-default.jpg"))).toBe(true);
    expect(existsSync(join(root, "dist/client/assets/media/favicon-32.png"))).toBe(true);
  });
});

function waitForOutput(child, expected) {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}. Output:\n${output}`));
    }, 10_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!output.includes(expected)) return;
      cleanup();
      resolvePromise();
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`watch-media exited with ${code}. Output:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

function svg(fill) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${fill}"/></svg>`;
}
