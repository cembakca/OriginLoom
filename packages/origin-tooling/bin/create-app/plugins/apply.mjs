/**
 * Plugin patch engine and template merger for origin-create-app.
 *
 * Text patches target explicit anchors in generated source files. Missing
 * anchors fail loudly — plugins must not silently no-op when the base template
 * moves.
 */
export class PatchError extends Error {}

/** Stable anchors in the base template; plugins patch relative to these. */
export const HOOKS = {
  MIDDLEWARE_EXPORTS: "// @originloom:hook middleware-exports",
  PACKAGE_JSON_SCRIPTS: "// @originloom:hook package-json-scripts",
  README_OPS_TABLE: "<!-- @originloom:hook readme-ops-table -->",
};

/**
 * @param {string} content
 * @param {string} anchor
 * @param {string} insertion
 * @param {{ pluginId: string; path: string }} context
 */
export function insertAfter(content, anchor, insertion, context) {
  const index = content.indexOf(anchor);
  if (index === -1) {
    throw new PatchError(`[${context.pluginId}] anchor not found in ${context.path}: ${anchor}`);
  }
  const after = index + anchor.length;
  const trimmed = insertion.trim();
  if (trimmed && content.includes(trimmed)) {
    throw new PatchError(`[${context.pluginId}] duplicate patch in ${context.path}`);
  }
  return content.slice(0, after) + insertion + content.slice(after);
}

/**
 * @param {string} content
 * @param {string} anchor
 * @param {string} insertion
 * @param {{ pluginId: string; path: string }} context
 */
export function insertBefore(content, anchor, insertion, context) {
  const index = content.indexOf(anchor);
  if (index === -1) {
    throw new PatchError(`[${context.pluginId}] anchor not found in ${context.path}: ${anchor}`);
  }
  const trimmed = insertion.trim();
  if (trimmed && content.includes(trimmed)) {
    throw new PatchError(`[${context.pluginId}] duplicate patch in ${context.path}`);
  }
  return content.slice(0, index) + insertion + content.slice(index);
}

/**
 * @param {string} content
 * @param {string} anchor
 * @param {string} replacement
 * @param {{ pluginId: string; path: string }} context
 */
export function replaceBlock(content, anchor, replacement, context) {
  const index = content.indexOf(anchor);
  if (index === -1) {
    throw new PatchError(`[${context.pluginId}] anchor not found in ${context.path}: ${anchor}`);
  }
  return content.slice(0, index) + replacement + content.slice(index + anchor.length);
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {{ scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }} patches
 */
export function mergePackageJsonManifest(manifest, patches) {
  const next = structuredClone(manifest);
  if (patches.scripts) {
    next.scripts ??= {};
    for (const [key, value] of Object.entries(patches.scripts)) {
      if (next.scripts[key] !== undefined && next.scripts[key] !== value) {
        throw new PatchError(`package.json script conflict on ${key}`);
      }
      next.scripts[key] = value;
    }
  }
  for (const section of ["dependencies", "devDependencies"]) {
    if (!patches[section]) continue;
    next[section] ??= {};
    for (const [key, value] of Object.entries(patches[section])) {
      if (next[section][key] !== undefined && next[section][key] !== value) {
        throw new PatchError(`package.json ${section} conflict on ${key}`);
      }
      next[section][key] = value;
    }
  }
  return next;
}

/**
 * @param {string} content
 * @param {Array<{ type: string; anchor?: string; content?: string; replacement?: string }>} patches
 * @param {{ pluginId: string; path: string }} context
 */
export function applyTextPatches(content, patches, context) {
  let result = content;
  for (const patch of patches) {
    switch (patch.type) {
      case "insertAfter":
        result = insertAfter(result, patch.anchor, patch.content ?? "", context);
        break;
      case "insertBefore":
        result = insertBefore(result, patch.anchor, patch.content ?? "", context);
        break;
      case "replaceBlock":
        result = replaceBlock(result, patch.anchor, patch.replacement ?? "", context);
        break;
      default:
        throw new PatchError(`[${context.pluginId}] unknown patch type: ${patch.type}`);
    }
  }
  return result;
}

/**
 * @param {Record<string, string>} files
 * @param {string[]} pluginIds
 * @param {import("./registry.mjs").PluginContext} ctx
 * @param {Map<string, import("./registry.mjs").CreateAppPlugin>} pluginsById
 */
export function applyPluginsToTemplates(files, pluginIds, ctx, pluginsById) {
  const merged = { ...files };

  for (const id of pluginIds) {
    const plugin = pluginsById.get(id);
    if (!plugin) throw new PatchError(`Unknown plugin: ${id}`);

    const pluginFiles = plugin.files?.(ctx) ?? {};
    for (const [path, content] of Object.entries(pluginFiles)) {
      if (merged[path] !== undefined && merged[path] !== content) {
        throw new PatchError(`[${id}] file conflict: ${path}`);
      }
      merged[path] = content;
    }

    if (plugin.packageJsonPatches && merged["package.json"]) {
      const manifest = JSON.parse(merged["package.json"]);
      const next = mergePackageJsonManifest(manifest, plugin.packageJsonPatches);
      merged["package.json"] = JSON.stringify(next, null, 2) + "\n";
    }

    for (const [path, patches] of Object.entries(plugin.textPatches ?? {})) {
      if (merged[path] === undefined) {
        throw new PatchError(`[${id}] patch target missing: ${path}`);
      }
      merged[path] = applyTextPatches(merged[path], patches, { pluginId: id, path });
    }
  }

  return merged;
}

/**
 * @param {{ plugins?: string[]; withOps?: boolean }} options
 * @returns {string[]}
 */
export function resolvePluginIds(options) {
  const ids = new Set(options.plugins ?? []);
  if (options.withOps) ids.add("with-ops");
  return [...ids];
}
