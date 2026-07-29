#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createRouteManifest, renderRouteManifest } from "./route-manifest-lib.mjs";

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const routesPath = resolve(root, process.env.ORIGIN_ROUTES_ENTRY ?? "server/routes/index.ts");
const rulesPath = resolve(root, process.env.ORIGIN_ROUTING_RULES ?? "src/routing/rules.ts");
const outputPath = resolve(root, "dist/originloom-manifest.json");

if (!existsSync(routesPath)) {
  throw new Error(
    `Route registry not found: ${routesPath}. Set ORIGIN_ROUTES_ENTRY to the module exporting routes.`,
  );
}

const routeModule = await import(pathToFileURL(routesPath).href);
const rulesModule = existsSync(rulesPath) ? await import(pathToFileURL(rulesPath).href) : {};
const manifest = createRouteManifest({
  routes: routeModule.routes,
  redirects: rulesModule.redirects ?? [],
  rewrites: rulesModule.rewrites ?? [],
  distDir: resolve(root, "dist"),
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(renderRouteManifest(manifest));
console.log(`\nManifest: ${outputPath}\n`);
