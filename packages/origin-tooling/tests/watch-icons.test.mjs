import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const WATCH_ICONS = fileURLToPath(new URL("../bin/watch-icons.mjs", import.meta.url));
const scratchDirectories = [];
const children = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Same watcher/debounce cost as the media watch — see that file. */
describe("icon watch", { timeout: 30_000 }, () => {
  it("regenerates once for its config and ignores sibling-file writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "originloom-icon-watch-"));
    scratchDirectories.push(root);
    const svgDirectory = join(root, "src/assets/svg");
    mkdirSync(svgDirectory, { recursive: true });
    writeFileSync(
      join(svgDirectory, "mark.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 12h20"/></svg>',
    );
    const configPath = join(root, ".svgrrc.cjs");
    writeFileSync(configPath, "module.exports = { typescript: true };\n");

    const child = spawn(process.execPath, [WATCH_ICONS], {
      cwd: root,
      env: { ...process.env, ORIGIN_APP_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    const output = captureOutput(child);

    await output.waitFor("[icons:watch] watching");
    writeFileSync(join(root, "unrelated.txt"), "unrelated\n");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(output.value()).not.toContain("[icons:watch] regenerated");

    writeFileSync(configPath, "module.exports = { typescript: true, icon: true };\n");
    await output.waitFor("[icons:watch] regenerated (config:.svgrrc.cjs)");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(output.value().match(/\[icons:watch] regenerated/g)).toHaveLength(1);
  });
});

function captureOutput(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return {
    value: () => output,
    waitFor(expected, timeoutMs = 10_000) {
      return new Promise((resolvePromise, reject) => {
        const deadline = Date.now() + timeoutMs;
        const poll = () => {
          if (output.includes(expected)) {
            resolvePromise();
            return;
          }
          if (Date.now() >= deadline) {
            reject(new Error(`Timed out waiting for ${expected}. Output:\n${output}`));
            return;
          }
          setTimeout(poll, 10);
        };
        poll();
      });
    },
  };
}
