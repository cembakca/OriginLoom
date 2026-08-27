import { config } from "./config.js";

function externalHttpUrl(path: string): string | null {
  if (!/^https?:\/\//i.test(path)) return null;
  const url = new URL(path);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported asset URL protocol: ${url.protocol}`);
  }
  return path;
}

function safeRelativeAssetPath(path: string): string {
  if (!path || path.startsWith("//") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`Invalid asset path: ${path}`);
  }

  const suffixIndex = path.search(/[?#]/);
  const pathname = suffixIndex === -1 ? path : path.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : path.slice(suffixIndex);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new Error(`Invalid asset path encoding: ${path}`);
  }
  if (decoded.includes("\\") || decoded.includes("\0")) {
    throw new Error(`Invalid asset path: ${path}`);
  }

  const segments = decoded.replace(/^\/+/, "").split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid asset path: ${path}`);
  }
  return `${pathname.replace(/^\/+/, "")}${suffix}`;
}

function namespacedUrl(pathname: string): string {
  const local = `/${pathname}`;
  const base = config.assetCdnEnabled ? config.assetCdnUrl : undefined;
  return base ? `${base}${local}` : local;
}

export function clientAssetPathPrefix(): string {
  return `/${config.assetNamespace}/assets`;
}

export function publicAssetPathPrefix(): string {
  return `/${config.assetNamespace}-icons`;
}

/** Canonical browser path for a Vite-built client asset. */
export function clientAssetUrl(path: string): string {
  const external = externalHttpUrl(path);
  if (external) return external;
  const relative = safeRelativeAssetPath(path);
  if (!relative.startsWith("assets/")) {
    throw new Error(`Client asset path must start with assets/: ${path}`);
  }
  return namespacedUrl(`${config.assetNamespace}/${relative}`);
}

/** Canonical browser path for an unprocessed file below public/<namespace>-icons. */
export function publicAssetUrl(path: string): string {
  const external = externalHttpUrl(path);
  if (external) return external;
  return namespacedUrl(`${config.assetNamespace}-icons/${safeRelativeAssetPath(path)}`);
}

/** @deprecated Use clientAssetUrl() for Vite-built assets. */
export function assetUrl(path: string): string {
  return clientAssetUrl(path);
}
