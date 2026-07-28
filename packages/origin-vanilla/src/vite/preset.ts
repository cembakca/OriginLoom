import type { ClientViteConfigOptions, ServerViteConfigOptions } from "@originloom/shared/vite";
import {
  createBaseClientViteConfig,
  createServerViteConfig as createBaseServerViteConfig,
} from "@originloom/shared/vite";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";

export type {
  ClientViteConfigOptions,
  DevReloadOptions,
  ServerViteConfigOptions,
} from "@originloom/shared/vite";
export { createDevReloadPlugin } from "@originloom/shared/vite";

/**
 * Client bundle for an app with no UI framework: plain TypeScript islands, so
 * the only plugin is the CSS engine. No JSX transform, no framework dedupe.
 */
export function createClientViteConfig(options: ClientViteConfigOptions): UserConfig {
  return createBaseClientViteConfig({ ...options, plugins: [tailwindcss()] });
}

/** SSR server bundle: single self-contained index.js consumed by plain Node. */
export function createServerViteConfig(options: ServerViteConfigOptions): UserConfig {
  return createBaseServerViteConfig(options);
}
