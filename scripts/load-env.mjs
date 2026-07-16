import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(content) {
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function applyEnvFile(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) return {};

  const vars = parseEnvFile(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return vars;
}

/** @param {string} appEnv development | staging | production */
export function loadEnv(appEnv) {
  const files = [`.env.${appEnv}`, `.env.${appEnv}.local`, ".env.local"];
  const loaded = {};
  for (const file of files) {
    Object.assign(loaded, applyEnvFile(file));
  }
  if (process.env.APP_ENV === undefined) process.env.APP_ENV = appEnv;
  return loaded;
}

/** @param {string} relativePath */
export function loadEnvOverlay(relativePath) {
  return applyEnvFile(relativePath);
}

export function resolveAppEnv() {
  return process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
}
