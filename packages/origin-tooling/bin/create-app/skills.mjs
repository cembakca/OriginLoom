/**
 * Claude Code skills shipped inside every generated app.
 *
 * Each `skills/<name>.md` here is copied to the app's
 * `.claude/skills/<name>/SKILL.md`, so Claude Code picks it up automatically and
 * knows this codebase's patterns — adding a page, the cache layer, islands,
 * Tailwind, and the code conventions — without being told each time.
 *
 * Renderer-specific guidance lives in `skills/<renderer>/<name>.md` and replaces
 * the default file of the same name; skills that read the same either way are
 * written once.
 *
 * The sources are plain Markdown (no escaping) and get packed via files: ["bin"].
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = fileURLToPath(new URL("./skills", import.meta.url));

/**
 * @param {"react" | "vanilla"} renderer
 * @returns {Record<string, string>} map of app-relative path -> file contents
 */
export function renderSkills(renderer = "react") {
  const overrideDir = join(skillsDir, renderer);
  const overrides = existsSync(overrideDir) ? new Set(markdownFiles(overrideDir)) : new Set();

  const files = {};
  for (const entry of markdownFiles(skillsDir)) {
    const name = entry.slice(0, -".md".length);
    const source = overrides.has(entry) ? join(overrideDir, entry) : join(skillsDir, entry);
    files[`.claude/skills/${name}/SKILL.md`] = readFileSync(source, "utf8");
  }
  return files;
}

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
}
