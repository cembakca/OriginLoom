import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const cacheDescriptionSymbol = Symbol.for("originloom.route-cache-description");

export function createRouteManifest({ routes, redirects = [], rewrites = [], distDir }) {
  if (!Array.isArray(routes)) throw new Error("Route entry must export a routes array");

  const seen = new Set();
  const routeEntries = routes.map((route, order) => {
    if (!route || typeof route.path !== "string" || !route.path.startsWith("/")) {
      throw new Error(`Invalid route at index ${order}: expected an absolute path`);
    }
    if (seen.has(route.path)) throw new Error(`Duplicate route path: ${route.path}`);
    seen.add(route.path);

    return {
      order,
      path: route.path,
      type: route.streaming ? "streaming" : isDynamicPath(route.path) ? "dynamic" : "static",
      cache: describeCache(route.cache),
      streaming: route.streaming === true,
      validatesParams: typeof route.validateParams === "function",
      minimalChrome: route.minimalChrome === true,
      preloadIslands: Array.isArray(route.preloadIslands) ? [...route.preloadIslands] : [],
    };
  });

  const routing = {
    redirects: redirects.map((rule) => ({
      source: rule.source,
      destination: rule.destination,
      status: rule.status,
    })),
    rewrites: rewrites.map((rule) => ({
      source: rule.source,
      destination: rule.destination,
      type: /^https?:\/\//.test(rule.destination) ? "proxy" : "rewrite",
    })),
  };

  return {
    schemaVersion: 1,
    routes: routeEntries,
    routing,
    assets: distDir ? inspectAssets(distDir) : undefined,
    summary: {
      routes: routeEntries.length,
      static: routeEntries.filter((route) => route.type === "static").length,
      dynamic: routeEntries.filter((route) => route.type === "dynamic").length,
      streaming: routeEntries.filter((route) => route.streaming).length,
      htmlCached: routeEntries.filter((route) =>
        ["shared", "conditional"].includes(route.cache.mode),
      ).length,
      runtimeCachePolicy: routeEntries.filter((route) => route.cache.mode === "runtime").length,
      redirects: routing.redirects.length,
      rewrites: routing.rewrites.filter((rule) => rule.type === "rewrite").length,
      proxies: routing.rewrites.filter((rule) => rule.type === "proxy").length,
    },
  };
}

export function renderRouteManifest(manifest) {
  const rows = manifest.routes.map((route) => [
    route.path,
    route.type,
    formatCache(route.cache),
    route.validatesParams ? "yes" : "—",
    route.preloadIslands.length ? route.preloadIslands.join(", ") : "—",
  ]);
  const headers = ["Route", "Type", "HTML cache", "Params", "Preload islands"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const line = (cells) =>
    cells
      .map((cell, index) => String(cell).padEnd(widths[index]))
      .join("  ")
      .trimEnd();

  const output = [
    "",
    "OriginLoom build summary",
    "",
    line(headers),
    line(widths.map((n) => "─".repeat(n))),
  ];
  for (const row of rows) output.push(line(row));

  const rules = [
    ...manifest.routing.redirects.map(
      (rule) => `  ${rule.source}  ${rule.status} → ${rule.destination}`,
    ),
    ...manifest.routing.rewrites.map(
      (rule) =>
        `  ${rule.source}  ${rule.type === "proxy" ? "proxy" : "rewrite"} → ${rule.destination}`,
    ),
  ];
  if (rules.length) output.push("", "Routing rules", ...rules);

  const { summary } = manifest;
  output.push(
    "",
    "Summary",
    `  Routes: ${summary.routes} (${summary.static} static, ${summary.dynamic} dynamic, ${summary.streaming} streaming)`,
    `  HTML cache: ${summary.htmlCached} described, ${summary.runtimeCachePolicy} runtime-defined`,
    `  Rules: ${summary.redirects} redirect, ${summary.rewrites} rewrite, ${summary.proxies} proxy`,
  );
  if (manifest.assets) {
    output.push(
      `  Client assets: ${manifest.assets.clientFiles} files · ${formatBytes(manifest.assets.clientBytes)}`,
      `  Server bundle: ${formatBytes(manifest.assets.serverBytes)}`,
      `  Precompressed assets: ${manifest.assets.precompressedFiles}`,
    );
  }
  if (summary.runtimeCachePolicy) {
    output.push(
      "",
      "  * runtime-defined: resolver has no build metadata; runtime behavior remains authoritative.",
    );
  }
  return output.join("\n");
}

function describeCache(resolver) {
  if (typeof resolver !== "function") return { mode: "none", source: "implicit" };
  const description = resolver[cacheDescriptionSymbol];
  if (!description || typeof description !== "object") {
    return { mode: "runtime", source: "unannotated" };
  }
  return { ...description, source: "described" };
}

function formatCache(cache) {
  if (cache.mode === "none") return "none";
  if (cache.mode === "runtime") return "runtime-defined*";
  const ttl = formatDuration(cache.ttl);
  const swr = cache.swr === undefined ? "" : ` + SWR ${formatDuration(cache.swr)}`;
  const conditional = cache.mode === "conditional" ? " (conditional)" : "";
  return `shared ${ttl}${swr}${conditional}`;
}

function isDynamicPath(path) {
  return path.split("/").some((segment) => segment.startsWith(":") || segment.includes("*"));
}

function inspectAssets(distDir) {
  const clientRoot = join(distDir, "client");
  const serverEntry = join(distDir, "server", "index.js");
  const files = existsSync(clientRoot) ? walk(clientRoot) : [];
  return {
    clientFiles: files.filter((path) => !path.endsWith(".br") && !path.endsWith(".gz")).length,
    clientBytes: files
      .filter((path) => !path.endsWith(".br") && !path.endsWith(".gz"))
      .reduce((total, path) => total + statSync(path).size, 0),
    serverBytes: existsSync(serverEntry) ? statSync(serverEntry).size : 0,
    precompressedFiles: files.filter((path) => path.endsWith(".br") || path.endsWith(".gz")).length,
  };
}

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function formatDuration(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  return `${(bytes / 1024).toFixed(2)} KiB`;
}
