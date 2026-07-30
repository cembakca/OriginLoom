import { existsSync as fsExistsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const workspaceRoot = findWorkspaceRoot(root);
// In a workspace the platform packages are source dirs we also walk (and enforce
// layering across). Standalone, they are external node_modules — checked only for
// the app's own cycles.
const packageRoots = workspaceRoot
  ? {
      "@originloom/shared": join(workspaceRoot, "packages/origin-shared/src"),
      "@originloom/core": join(workspaceRoot, "packages/origin-core/src"),
      "@originloom/react": join(workspaceRoot, "packages/origin-react/src"),
    }
  : {};
/**
 * Layering guard. `@originloom/shared` is the framework-neutral base everything
 * else builds on. The server core and the renderer adapter (`react`)
 * meet only through the `OriginRenderer` contract in shared, so none of them may
 * import another — including one adapter reaching for the other.
 */
const forbiddenLayerEdges = [
  ["@originloom/react", "@originloom/core"],
  ["@originloom/core", "@originloom/react"],
  ["@originloom/shared", "@originloom/core"],
  ["@originloom/shared", "@originloom/react"],
];
/**
 * Framework guard: the server core and the neutral base render through the
 * `OriginRenderer` seam, so neither may reach a UI framework — not even for a
 * type.
 */
const frameworkSpecifiers = [
  /^react(\/|$)/,
  /^react-dom(\/|$)/,
  /^preact(\/|$)/,
  /^@tanstack\/react-/,
  /^@originloom\/react(\/|$)/,
];
const sourceRoots = [join(root, "server"), join(root, "src"), ...Object.values(packageRoots)];
const extensions = [".ts", ".tsx", ".js", ".mjs"];
const files = (await Promise.all(sourceRoots.map(walk))).flat();
const fileSet = new Set(files);
const graph = new Map();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const dependencies = new Set();
  for (const { text, runtime } of collectImports(file, source)) {
    // Type-only imports still count here: a React type in the core is a leak.
    assertFrameworkFree(file, text);
    if (!runtime) continue;
    const dependency = resolveImport(file, text);
    if (dependency) {
      assertLayering(file, dependency);
      dependencies.add(dependency);
    }
  }
  graph.set(file, [...dependencies]);
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
  else {
    for (const [name, packageRoot] of Object.entries(packageRoots)) {
      if (specifier === name) base = packageRoot;
      else if (specifier.startsWith(`${name}/`))
        base = join(packageRoot, specifier.slice(name.length + 1));
    }
    if (!base) return null;
  }

  const candidates = extname(base)
    ? [base]
    : [
        ...extensions.map((extension) => `${base}${extension}`),
        ...extensions.map((extension) => join(base, `index${extension}`)),
      ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

/** Every import in the file, flagged with whether it survives type erasure. */
function collectImports(file, source) {
  const specifiers = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  visitNode(sourceFile);
  return specifiers;

  function visitNode(node) {
    if (ts.isImportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier, isRuntimeImport(node));
    } else if (ts.isExportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier, isRuntimeExport(node));
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference))
        addModuleSpecifier(reference.expression, !node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addModuleSpecifier(node.arguments[0], true);
    }

    ts.forEachChild(node, visitNode);
  }

  function addModuleSpecifier(node, runtime) {
    if (node && ts.isStringLiteralLike(node)) specifiers.push({ text: node.text, runtime });
  }
}

function isRuntimeImport(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings))
    return true;
  return (
    clause.namedBindings.elements.length === 0 ||
    clause.namedBindings.elements.some((item) => !item.isTypeOnly)
  );
}

function isRuntimeExport(node) {
  if (!node.moduleSpecifier || node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return (
    node.exportClause.elements.length === 0 ||
    node.exportClause.elements.some((item) => !item.isTypeOnly)
  );
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".js") || file.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function walk(directory) {
  if (!fsExistsSync(directory)) return [];
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

/**
 * `resolveImport` returns null for bare package specifiers, so this runs off the
 * raw specifier instead of the resolved file.
 */
function assertFrameworkFree(file, specifier) {
  if (!workspaceRoot) return;
  const roots = [packageRoots["@originloom/core"], packageRoots["@originloom/shared"]].filter(
    Boolean,
  );
  if (!roots.some((packageRoot) => file.startsWith(packageRoot))) return;
  if (frameworkSpecifiers.some((pattern) => pattern.test(specifier))) {
    throw new Error(
      `Framework boundary violation: ${relative(workspaceRoot, file)} imports "${specifier}" — render through OriginRenderer instead`,
    );
  }
}

function assertLayering(importer, dependency) {
  if (!workspaceRoot) return; // standalone: packages are external, not walked
  for (const [from, to] of forbiddenLayerEdges) {
    const fromRoot = packageRoots[from];
    const toRoot = packageRoots[to];
    if (!fromRoot || !toRoot) continue;
    if (importer.startsWith(fromRoot) && dependency.startsWith(toRoot)) {
      throw new Error(
        `Layering violation: ${from} must not import ${to} (${relative(workspaceRoot, importer)} -> ${relative(workspaceRoot, dependency)})`,
      );
    }
  }
}

/** Returns the workspace root, or null when run in a standalone (single-app) repo. */
function findWorkspaceRoot(start) {
  let current = start;
  for (;;) {
    if (fsExistsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
