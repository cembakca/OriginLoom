/**
 * Claude Code skills shipped inside every generated app.
 *
 * Each `skills/<name>.md` here is copied to the app's
 * `.claude/skills/<name>/SKILL.md`, so Claude Code picks it up automatically and
 * knows this codebase's patterns — adding a page, the cache layer, islands,
 * Tailwind, and the code conventions — without being told each time.
 *
 * The sources are plain Markdown (no escaping) and get packed via files: ["bin"].
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = fileURLToPath(new URL("./skills", import.meta.url));

/**
 * Skills that describe an opt-in plugin. Shipping one to an app that does not
 * have the feature is worse than shipping none: it tells Claude Code to use
 * files that are not there.
 */
const OPTIONAL_SKILLS = { "i18n.md": "i18n" };

/**
 * @param {{ i18n?: boolean }} enabled which optional plugins this app generated
 * @returns {Record<string, string>} map of app-relative path -> file contents
 */
export function renderSkills(enabled = {}) {
  const files = {};
  for (const entry of markdownFiles(skillsDir)) {
    const plugin = OPTIONAL_SKILLS[entry];
    if (plugin && !enabled[plugin]) continue;
    const name = entry.slice(0, -".md".length);
    files[`.claude/skills/${name}/SKILL.md`] = readFileSync(join(skillsDir, entry), "utf8");
  }
  return files;
}

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
}
