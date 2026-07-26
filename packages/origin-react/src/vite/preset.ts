import type { ClientViteConfigOptions, ServerViteConfigOptions } from "@originloom/shared/vite";
import {
  createBaseClientViteConfig,
  createServerViteConfig as createBaseServerViteConfig,
} from "@originloom/shared/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite";

export type {
  ClientViteConfigOptions,
  DevReloadOptions,
  ServerViteConfigOptions,
} from "@originloom/shared/vite";
export { createDevReloadPlugin } from "@originloom/shared/vite";

/** React runtime must resolve to one copy across the app and the packages. */
const DEDUPE = ["react", "react-dom"];

/** Client island bundle. The server is plain Node — it never goes through Vite. */
export function createClientViteConfig(options: ClientViteConfigOptions): UserConfig {
  return createBaseClientViteConfig({
    ...options,
    plugins: [react(), tailwindcss()],
    dedupe: DEDUPE,
  });
}

/**
 * SSR server bundle: single self-contained index.js consumed by plain Node.
 * `@originloom/react/server` (the render adapter) belongs to this bundle only —
 * it pulls in react-dom/server and must never be reached from the client entry.
 */
export function createServerViteConfig(options: ServerViteConfigOptions): UserConfig {
  return createBaseServerViteConfig({ dedupe: DEDUPE, ...options });
}
