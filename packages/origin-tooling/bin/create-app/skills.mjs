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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = fileURLToPath(new URL("./skills", import.meta.url));

/** @returns {Record<string, string>} map of app-relative path -> file contents */
export function renderSkills() {
  const files = {};
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.slice(0, -".md".length);
    files[`.claude/skills/${name}/SKILL.md`] = readFileSync(join(skillsDir, entry), "utf8");
  }
  return files;
}
