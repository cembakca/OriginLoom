import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const sourceRoots = [join(root, "server"), join(root, "src")];
const extensions = [".ts", ".tsx", ".js", ".mjs"];
const files = (await Promise.all(sourceRoots.map(walk))).flat();
const fileSet = new Set(files);
const graph = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const dependencies = [];
  const imports = source.matchAll(/(?:import|export)\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["']/g);
  for (const match of imports) {
    const dependency = resolveImport(file, match[1]);
    if (dependency) dependencies.push(dependency);
  }
  graph.set(file, dependencies);
}

const visiting = new Set();
const visited = new Set();
const stack = [];

for (const file of files) visit(file);
console.log(`[cycles] ${files.length} source files checked`);

function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map((entry) => relative(root, entry)).join(" -> ");
    throw new Error(`Import cycle detected: ${cycle}`);
  }
  if (visited.has(file)) return;
  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

function resolveImport(importer, specifier) {
  let base;
  if (specifier.startsWith("@server/")) base = join(root, "server", specifier.slice(8));
  else if (specifier.startsWith("~/")) base = join(root, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
  else return null;

  const candidates = extname(base)
    ? [base]
    : [
        ...extensions.map((extension) => `${base}${extension}`),
        ...extensions.map((extension) => join(base, `index${extension}`)),
      ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return extensions.includes(extname(entry.name)) ? [path] : [];
    }),
  );
  return nested.flat();
}
