import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { PROJECT_FILE } from "./compatibility.mjs";

export const PLATFORM_PACKAGES = ["shared", "core", "react", "vanilla", "tooling"];

export function findProjectRoot(start = process.cwd()) {
  let current = resolve(start);
  for (;;) {
    const metadata = join(current, PROJECT_FILE);
    const manifest = join(current, "package.json");
    if (existsSync(metadata)) return current;
    if (existsSync(manifest)) {
      const pkg = readJson(manifest);
      if (declaredOriginloomPackages(pkg).length > 0) return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function readProject(root) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) throw new Error("package.json bulunamadı: " + root);
  const pkg = readJson(packagePath);
  const metadataPath = join(root, PROJECT_FILE);
  const metadata = existsSync(metadataPath) ? readJson(metadataPath) : null;
  return {
    root,
    packagePath,
    pkg,
    metadataPath,
    metadata,
    renderer: detectRenderer(pkg, metadata),
    mode: metadata?.mode ?? inferMode(pkg),
  };
}

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(path + " geçerli JSON değil: " + error.message, { cause: error });
  }
}

export function declaredOriginloomPackages(pkg) {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.entries(all)
    .filter(([name]) => name.startsWith("@originloom/"))
    .map(([name, range]) => ({ name, range }));
}

export function detectRenderer(pkg, metadata) {
  if (metadata?.renderer === "react" || metadata?.renderer === "vanilla") {
    return metadata.renderer;
  }
  if (pkg.dependencies?.["@originloom/react"]) return "react";
  if (pkg.dependencies?.["@originloom/vanilla"]) return "vanilla";
  return "unknown";
}

function inferMode(pkg) {
  return declaredOriginloomPackages(pkg).some(({ range }) => range === "workspace:*")
    ? "workspace"
    : "standalone";
}
