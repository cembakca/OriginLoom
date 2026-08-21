#!/usr/bin/env node
/** Watches the media config and every local source it references during dev. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const CONFIG_PATH = resolve(ROOT, "server/media.config.json");
const BUILD_SCRIPT = fileURLToPath(new URL("./build-media.mjs", import.meta.url));
const DEBOUNCE_MS = 150;

let debounceTimer;
let running = false;
let pending = false;
let sourceWatchers = [];

function scheduleRebuild(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void rebuild(reason);
  }, DEBOUNCE_MS);
}

function rebuild(reason) {
  if (running) {
    pending = true;
    return Promise.resolve();
  }

  running = true;
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", fail);
    child.once("exit", (code) => {
      if (code === 0) {
        refreshSourceWatchers();
        console.log(`[media:watch] regenerated (${reason})`);
        settle();
        return;
      }
      fail(new Error(`build-media exited with code ${code}`));
    });
  })
    .catch((error) => {
      console.error("[media:watch] failed:", error.message ?? error);
    })
    .finally(() => {
      running = false;
      if (pending) {
        pending = false;
        scheduleRebuild("queued change");
      }
    });
}

function configuredSources() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const paths = [config.seoAssets?.openGraphSource, config.seoAssets?.brandSource];
  for (const image of config.images ?? []) paths.push(image?.source);
  for (const font of config.fonts ?? []) paths.push(font?.source, font?.license);
  return [
    ...new Set(paths.filter((path) => typeof path === "string").map((path) => resolve(ROOT, path))),
  ];
}

function refreshSourceWatchers() {
  let sources;
  try {
    sources = configuredSources();
  } catch (error) {
    console.error("[media:watch] could not read config:", error.message ?? error);
    return;
  }

  for (const watcher of sourceWatchers) watcher.close();
  sourceWatchers = [];

  const watchedByDirectory = new Map();
  for (const source of sources) {
    if (!existsSync(source)) continue;
    const directory = dirname(source);
    const names = watchedByDirectory.get(directory) ?? new Set();
    names.add(basename(source));
    watchedByDirectory.set(directory, names);
  }

  for (const [directory, names] of watchedByDirectory) {
    sourceWatchers.push(
      watch(directory, (_event, filename) => {
        if (!filename || !names.has(filename.toString())) return;
        scheduleRebuild(`source:${filename}`);
      }),
    );
  }
}

if (!existsSync(CONFIG_PATH)) {
  console.error("[media:watch] missing server/media.config.json — nothing to watch");
  process.exit(1);
}

watch(dirname(CONFIG_PATH), (_event, filename) => {
  if (filename?.toString() !== basename(CONFIG_PATH)) return;
  scheduleRebuild("config:media.config.json");
});
refreshSourceWatchers();

console.log(`[media:watch] watching ${CONFIG_PATH}`);

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
