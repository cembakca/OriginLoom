#!/usr/bin/env node
/**
 * Watches SVG sources (and SVGR config) and re-runs icon codegen during dev.
 */
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const SVG_DIR = join(ROOT, "src/assets/svg");
const SVGR_CONFIG = join(ROOT, ".svgrrc.cjs");
const GENERATE_SCRIPT = fileURLToPath(new URL("./generate-icons.mjs", import.meta.url));
const DEBOUNCE_MS = 150;

let debounceTimer;
let running = false;
let pending = false;

function scheduleRegenerate(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void regenerate(reason);
  }, DEBOUNCE_MS);
}

function regenerate(reason) {
  if (running) {
    pending = true;
    return Promise.resolve();
  }

  running = true;
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [GENERATE_SCRIPT], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", fail);
    child.once("exit", (code) => {
      if (code === 0) {
        console.log(`[icons:watch] regenerated (${reason})`);
        settle();
        return;
      }
      fail(new Error(`generate-icons exited with code ${code}`));
    });
  })
    .catch((err) => {
      console.error("[icons:watch] failed:", err.message ?? err);
    })
    .finally(() => {
      running = false;
      if (pending) {
        pending = false;
        scheduleRegenerate("queued change");
      }
    });
}

function watchPath(label, path) {
  watch(path, { recursive: label === "svg" }, (_event, filename) => {
    if (filename && !filename.endsWith(".svg") && label === "svg") return;
    scheduleRegenerate(`${label}:${filename ?? "change"}`);
  });
}

if (!existsSync(SVG_DIR)) {
  console.error("[icons:watch] missing src/assets/svg — nothing to watch");
  process.exit(1);
}

watchPath("svg", SVG_DIR);
if (existsSync(SVGR_CONFIG)) watchPath("config", SVGR_CONFIG);

console.log(`[icons:watch] watching ${SVG_DIR}`);

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
