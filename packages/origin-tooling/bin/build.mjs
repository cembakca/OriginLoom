import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv("production");

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());

function run(label, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${label} stopped with ${signal}`));
      else if (code !== 0) reject(new Error(`${label} exited with code ${code}`));
      else resolve();
    });
  });
}

// Icons and media are opt-in: an app without SVG sources or a media config skips them.
if (existsSync(resolve(root, "src/assets/svg"))) {
  await run("icons", [new URL("./generate-icons.mjs", import.meta.url).pathname]);
}
await run("client", [resolve(root, "node_modules/vite/bin/vite.js"), "build"]);
// Immediately after the client build and before anything else touches dist/:
// a secret that reached the bundle has already been written to disk, and the
// only useful moment to say so is before it is served, compressed or shipped.
await run("client secrets", [new URL("./check-client-secrets.mjs", import.meta.url).pathname]);
if (existsSync(resolve(root, "server/media.config.json"))) {
  await run("media", [new URL("./build-media.mjs", import.meta.url).pathname]);
}
await run("assets", [new URL("./precompress-assets.mjs", import.meta.url).pathname]);
await run("server", [
  resolve(root, "node_modules/vite/bin/vite.js"),
  "build",
  "--config",
  "vite.server.config.ts",
]);
await run("route manifest", [
  "--import",
  "tsx/esm",
  new URL("./route-manifest.mjs", import.meta.url).pathname,
]);
