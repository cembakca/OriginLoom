import { withOpsPlugin } from "./with-ops/manifest.mjs";

/**
 * Registered create-app plugins. Expansion is frozen — only `with-ops` ships today.
 * See plugins/README.md and docs/plugin-mechanism.md before adding entries.
 *
 * @typedef {{
 *   name: string;
 *   title: string;
 *   port: number;
 *   metricsPort: number;
 *   vitePort: number;
 *   mode: "workspace" | "standalone";
 *   version: string;
 *   templateVersion: string;
 *   registry?: string;
 *   plugins: string[];
 * }} PluginContext
 */

/**
 * @typedef {{
 *   id: string;
 *   flags?: string[];
 *   files?: (ctx: PluginContext) => Record<string, string>;
 *   packageJsonPatches?: {
 *     scripts?: Record<string, string>;
 *     dependencies?: Record<string, string>;
 *     devDependencies?: Record<string, string>;
 *   };
 *   textPatches?: Record<string, Array<{ type: string; anchor?: string; content?: string; replacement?: string }>>;
 * }} CreateAppPlugin
 */

/** @type {CreateAppPlugin[]} */
export const plugins = [withOpsPlugin];

/** @type {Map<string, CreateAppPlugin>} */
export const pluginsById = new Map(plugins.map((plugin) => [plugin.id, plugin]));

/** @type {Map<string, string>} */
export const flagToPluginId = new Map(
  plugins.flatMap((plugin) => (plugin.flags ?? []).map((flag) => [flag, plugin.id])),
);

/** @returns {string[]} */
export function knownPluginFlags() {
  return [...flagToPluginId.keys()];
}

/**
 * @param {string} flag
 * @returns {string | undefined}
 */
export function resolveFlagToPluginId(flag) {
  return flagToPluginId.get(flag);
}
