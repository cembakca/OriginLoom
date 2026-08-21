import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareVersions,
  FIRST_TRACKED_TEMPLATE_VERSION,
  TOOLING_VERSION,
  UPGRADE_CONTRACT_MIGRATION,
} from "./compatibility.mjs";

export const ESLINT_10_MIGRATION = "0.5.17-eslint-10";
export const VITEST_SCOPE_MIGRATION = "0.5.18-vitest-scope";
export const REACT_QUALITY_SECURITY_MIGRATION = "0.5.34-react-quality-security";
export const ROUTE_BUILD_MANIFEST_MIGRATION = "0.5.35-route-build-manifest";
export const PRODUCT_MIDDLEWARE_MIGRATION = "0.5.36-product-middleware";
export const GATEWAY_STREAMING_MIGRATION = "0.6.0-gateway-backed-streaming";
export const REACT_ONLY_MIGRATION = "0.7.0-react-only";
export const GATEWAY_IDENTITY_MIGRATION = "0.7.3-gateway-identity";
export const PLUGIN_SCHEMA_MIGRATION = "0.7.11-plugin-schema-v2";
export const HONO_SSR_SECURITY_MIGRATION = "0.7.12-hono-ssr-security";
export const PUBLIC_STATIC_MIGRATION = "0.7.14-public-static";
export const SCAFFOLD_GATEWAY_MIGRATION = "0.7.14-scaffold-gateway";
export const NAVIGATION_PAINT_MIGRATION = "0.7.15-navigation-paint";
export const SSR_CAPACITY_MIGRATION = "0.7.16-ssr-capacity";
export const DEV_EXPERIENCE_MIGRATION = "0.7.17-dev-experience";
export const DEV_EXPERIENCE_SOURCE_PATCHES_MIGRATION = "0.7.18-dev-experience-source-patches";
export const GENERATION_AWARE_DEV_RELOAD_MIGRATION = "0.7.18-generation-aware-dev-reload";
export const HONO_4_13_MIGRATION = "0.7.20-hono-4.13";
export const CLIENT_ENTRY_TELEMETRY_IMPORT_FIX_MIGRATION =
  "0.7.21-client-entry-telemetry-import-fix";
export const SSR_ERROR_REFERENCE_MIGRATION = "0.7.22-ssr-error-reference";

const VIEW_TRANSITION_CSS = `
/* Same-origin navigations keep the outgoing page visible until the next document is ready. */
@view-transition {
  navigation: auto;
}
`;

function migrationAsset(name) {
  return readFileSync(
    fileURLToPath(new URL(`../create-app/assets/${name}`, import.meta.url)),
    "utf8",
  );
}

export const migrations = [
  {
    id: UPGRADE_CONTRACT_MIGRATION,
    introducedIn: FIRST_TRACKED_TEMPLATE_VERSION,
    description:
      "Project metadata, doctor/migrate scripts and the app-owned upgrade guide are installed.",
  },
  {
    id: ESLINT_10_MIGRATION,
    introducedIn: "0.5.17",
    description: "Generated projects adopt ESLint 10 and require Node.js 22.13 or newer.",
    migratePackage(manifest, changes) {
      manifest.engines ??= {};
      manifest.devDependencies ??= {};
      setDependency(manifest, changes, "engines", "node", ">=22.13.0");
      setDependency(manifest, changes, "devDependencies", "@eslint/js", "^10.0.1");
      setDependency(manifest, changes, "devDependencies", "eslint", "^10.8.0");
    },
  },
  {
    id: VITEST_SCOPE_MIGRATION,
    introducedIn: "0.5.18",
    description: "Vitest runs unit/integration tests without collecting Playwright e2e specs.",
    migratePackage(manifest, changes) {
      manifest.scripts ??= {};
      setDependency(manifest, changes, "scripts", "test", "vitest run tests");
    },
  },
  {
    id: REACT_QUALITY_SECURITY_MIGRATION,
    introducedIn: "0.5.34",
    description:
      "React quality tooling removes unsupported uuid and upgrades Lighthouse's vulnerable dependency chain.",
    migratePackage(manifest, changes) {
      const hasLighthouse = typeof manifest.devDependencies?.lighthouse === "string";
      const hasAutocannon = typeof manifest.devDependencies?.autocannon === "string";
      if (hasLighthouse) {
        manifest.engines ??= {};
        setDependency(manifest, changes, "engines", "node", ">=22.19.0");
        setDependency(manifest, changes, "devDependencies", "lighthouse", "^13.4.1");
      }
      if (hasAutocannon) {
        manifest.pnpm ??= {};
        manifest.pnpm.overrides ??= {};
        const selector = "autocannon>hyperid";
        const previous = manifest.pnpm.overrides[selector];
        if (previous !== "^4.0.0") {
          manifest.pnpm.overrides[selector] = "^4.0.0";
          changes.push({
            file: "package.json",
            kind: "dependency",
            detail: `pnpm.overrides.${selector}: ${previous ?? "yok"} → ^4.0.0`,
          });
        }
      }
    },
  },
  {
    id: ROUTE_BUILD_MANIFEST_MIGRATION,
    introducedIn: "0.5.35",
    description:
      "Build discovers the real route registry and emits a route/cache/routing manifest; cache metadata adoption is optional for existing apps.",
  },
  {
    id: PRODUCT_MIDDLEWARE_MIGRATION,
    introducedIn: "0.5.36",
    description:
      "Apps can register their own document middleware via createApp({ middleware }); adding server/middleware/ to an existing app is optional.",
  },
  {
    id: GATEWAY_STREAMING_MIGRATION,
    introducedIn: "0.6.0",
    description:
      "The React streaming example uses a validated gateway Promise instead of a route-local timer; existing product routes remain app-owned and are not overwritten.",
  },
  {
    id: REACT_ONLY_MIGRATION,
    introducedIn: "0.7.0",
    description:
      "The vanilla renderer is gone; @originloom/react is the only renderer package. Apps that already use it need no change.",
    migratePackage(manifest, changes) {
      if (!manifest.dependencies?.["@originloom/vanilla"]) return;
      // Nothing here can turn HTML-template pages into React components, so the
      // migration refuses rather than leaving a project that cannot install.
      changes.push({
        file: "package.json",
        kind: "dependency",
        detail:
          "@originloom/vanilla artık yayınlanmıyor — bu proje React renderer'a elle taşınmalıdır (docs/migrations/0.7.0.md)",
      });
    },
  },
  {
    id: GATEWAY_IDENTITY_MIGRATION,
    introducedIn: "0.7.3",
    description:
      "gatewayFetchWithIdentity carries the visitor's tracking id, client IP and device on every upstream call; existing services keep working and adopt it by taking the Request instead of an AbortSignal (docs/migrations/0.7.3.md).",
  },
  {
    id: PLUGIN_SCHEMA_MIGRATION,
    introducedIn: "0.7.11",
    description:
      "Project metadata records enabled create-app plugins (plugins: string[]). Existing apps default to an empty list; apps with compose:up infer with-ops (docs/migrations/0.7.11.md).",
  },
  {
    id: HONO_SSR_SECURITY_MIGRATION,
    introducedIn: "0.7.12",
    description:
      "Hono is bumped to >=4.12.34 for CVE-2026-71850 (hono/jsx memo SSR cross-request reuse) and related middleware fixes.",
    migratePackage(manifest, changes) {
      if (typeof manifest.dependencies?.hono !== "string") return;
      setDependency(manifest, changes, "dependencies", "hono", "^4.12.34");
    },
  },
  {
    id: PUBLIC_STATIC_MIGRATION,
    introducedIn: "0.7.14",
    description:
      "Adds public/ static files served at /public/* on the app port and copies the folder in Docker runner images.",
    migrateProject(root, changes, fileWrites) {
      for (const relPath of ["public/README.md", "public/test.img"]) {
        const target = join(root, relPath);
        if (existsSync(target)) continue;
        fileWrites[relPath] = migrationAsset(relPath);
        changes.push({
          file: relPath,
          kind: "add",
          detail: "Public static dosyası eklendi (/public/* altında servis edilir).",
        });
      }

      const dockerfilePath = join(root, "Dockerfile");
      if (!existsSync(dockerfilePath)) return;
      const dockerfile = readFileSync(dockerfilePath, "utf8");
      const publicCopy = "COPY --from=builder --chown=nodejs:nodejs /app/public ./public";
      if (dockerfile.includes(publicCopy)) return;
      const distCopy = "COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist\n";
      if (!dockerfile.includes(distCopy)) return;
      fileWrites.Dockerfile = dockerfile.replace(distCopy, `${distCopy}${publicCopy}\n`);
      changes.push({
        file: "Dockerfile",
        kind: "patch",
        detail: "Runner aşamasına public/ kopyası eklendi.",
      });
    },
  },
  {
    id: SCAFFOLD_GATEWAY_MIGRATION,
    introducedIn: "0.7.14",
    description:
      "Adds contracts:scaffold script (origin-scaffold-gateway) on projects that already use consumer contracts.",
    migratePackage(manifest, changes) {
      manifest.scripts ??= {};
      if (
        typeof manifest.scripts["contracts:fixtures"] !== "string" ||
        manifest.scripts["contracts:scaffold"] === "origin-scaffold-gateway"
      ) {
        return;
      }
      setDependency(manifest, changes, "scripts", "contracts:scaffold", "origin-scaffold-gateway");
    },
  },
  {
    id: NAVIGATION_PAINT_MIGRATION,
    introducedIn: "0.7.15",
    description:
      "Adds cross-document view transitions to globals.css; critical first-paint colors ship in @originloom/react DocumentLayout.",
    migrateProject(root, changes, fileWrites) {
      const globalsPath = join(root, "src/styles/globals.css");
      if (!existsSync(globalsPath)) return;
      const source = readFileSync(globalsPath, "utf8");
      if (source.includes("@view-transition")) return;
      fileWrites["src/styles/globals.css"] = `${source.trimEnd()}${VIEW_TRANSITION_CSS}\n`;
      changes.push({
        file: "src/styles/globals.css",
        kind: "patch",
        detail: "@view-transition { navigation: auto; } eklendi.",
      });
    },
  },
  {
    id: SSR_CAPACITY_MIGRATION,
    introducedIn: "0.7.16",
    description:
      "SSR cache HIT/STALE bypasses render admission; CPU-aware SSR_MAX_CONCURRENCY default and 503 runbook ship in @originloom/core.",
  },
  {
    id: DEV_EXPERIENCE_MIGRATION,
    introducedIn: "0.7.17",
    description:
      "Dev pretty logs, client error pageRequestId correlation, SVG/media watch during dev, and SVGO convertStyleToAttrs in the icon pipeline.",
  },
  {
    id: DEV_EXPERIENCE_SOURCE_PATCHES_MIGRATION,
    introducedIn: "0.7.18",
    description:
      "Known 0.7.17 app source patterns adopt SVGO normalization, page request logging, and import.meta.dirname automatically.",
    migrateProject(root, changes, fileWrites) {
      patchProjectFile(root, changes, fileWrites, ".svgrrc.cjs", patchSvgrConfig);
      patchProjectFile(root, changes, fileWrites, "src/entry.client.tsx", patchClientEntry);
      patchProjectFile(root, changes, fileWrites, "vite.config.ts", patchViteConfig);
    },
  },
  {
    id: GENERATION_AWARE_DEV_RELOAD_MIGRATION,
    introducedIn: "0.7.18",
    description:
      "Known generated Vite configs replace brittle SSR path allowlists with generation-aware readiness reloads.",
    migrateProject(root, changes, fileWrites) {
      patchProjectFile(root, changes, fileWrites, "vite.config.ts", patchDevReloadConfig);
    },
  },
  {
    id: CLIENT_ENTRY_TELEMETRY_IMPORT_FIX_MIGRATION,
    introducedIn: "0.7.21",
    description:
      "Repairs client entries where the 0.7.18 source patch placed logPageRequestIdInDev in the analytics data-layer import.",
    migrateProject(root, changes, fileWrites) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "src/entry.client.tsx",
        repairClientEntryTelemetryImport,
      );
    },
  },
  {
    id: SSR_ERROR_REFERENCE_MIGRATION,
    introducedIn: "0.7.22",
    description:
      "Generated React error boundaries receive and display the server errorId used by structured logs.",
    migrateProject(root, changes, fileWrites) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "server/product/boundary-pages.tsx",
        patchBoundaryErrorReference,
      );
    },
  },
  {
    id: HONO_4_13_MIGRATION,
    introducedIn: "0.7.20",
    description:
      "Hono is bumped to 4.13.3 and @hono/node-server to 2.1.1; compression now manages Vary: Accept-Encoding itself.",
    migratePackage(manifest, changes) {
      if (typeof manifest.dependencies?.hono === "string") {
        setDependency(manifest, changes, "dependencies", "hono", "^4.13.3");
      }
      if (typeof manifest.dependencies?.["@hono/node-server"] === "string") {
        setDependency(manifest, changes, "dependencies", "@hono/node-server", "^2.1.1");
      }
    },
  },
];

function patchProjectFile(root, changes, fileWrites, relativePath, patch) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return;
  // Several migrations may safely touch the same generated file in one run.
  // Compose from the staged result instead of letting the last patch erase the first.
  const source = fileWrites[relativePath] ?? readFileSync(path, "utf8");
  const next = patch(source);
  if (next === source) return;
  fileWrites[relativePath] = next;
  changes.push({
    file: relativePath,
    kind: "patch",
    detail: "Bilinen generated kalıp güvenli ve idempotent biçimde güncellendi.",
  });
}

function patchSvgrConfig(source) {
  if (
    source.includes('name: "convertStyleToAttrs"') ||
    source.includes("name: 'convertStyleToAttrs'")
  ) {
    return source;
  }

  const match = /^(\s*)(?:\{\s*)?name:\s*["']convertColors["']/m.exec(source);
  if (!match || match.index === undefined) return source;

  let insertAt = match.index;
  let indent = match[1];
  const previousLineEnd = insertAt > 0 ? insertAt - 1 : 0;
  const previousLineStart = source.lastIndexOf("\n", previousLineEnd - 1) + 1;
  if (source.slice(previousLineStart, previousLineEnd).trim() === "{") {
    insertAt = previousLineStart;
    indent = /^\s*/.exec(source.slice(previousLineStart))?.[0] ?? indent;
  }

  const addition =
    `${indent}// Figma exports often bake colours into style="" — normalize before convertColors.\n` +
    `${indent}{ name: "convertStyleToAttrs" },\n`;
  return source.slice(0, insertAt) + addition + source.slice(insertAt);
}

function patchClientEntry(source) {
  const importPattern =
    /import\s*\{([^}]*)\}\s*from\s*(["'])@originloom\/shared\/lib\/client\/error-telemetry\2;/;
  const importMatch = importPattern.exec(source);
  if (!importMatch) return source;

  let next = source;
  if (!/\blogPageRequestIdInDev\b/.test(importMatch[1])) {
    const bindings = importMatch[1]
      .split(",")
      .map((binding) => binding.trim())
      .filter(Boolean);
    const replacement = `import {\n  logPageRequestIdInDev,\n  ${bindings.join(",\n  ")},\n} from ${importMatch[2]}@originloom/shared/lib/client/error-telemetry${importMatch[2]};`;
    next = next.replace(importPattern, replacement);
  }

  if (/\blogPageRequestIdInDev\s*\(/.test(next)) return next;
  const installCall = "installReloadButtons();";
  if (next.includes(installCall)) {
    return next.replace(installCall, `${installCall}\nlogPageRequestIdInDev();`);
  }
  const bootstrapCall = "runIslandBootstrap(";
  if (next.includes(bootstrapCall)) {
    return next.replace(bootstrapCall, `logPageRequestIdInDev();\n\n${bootstrapCall}`);
  }
  return source;
}

function repairClientEntryTelemetryImport(source) {
  const analyticsImportPattern =
    /import\s*\{([^}]*)\}\s*from\s*(["'])@originloom\/shared\/lib\/analytics\/data-layer\2;/;
  const analyticsImport = analyticsImportPattern.exec(source);
  let next = source;
  if (analyticsImport && /\blogPageRequestIdInDev\b/.test(analyticsImport[1])) {
    const bindings = analyticsImport[1]
      .split(",")
      .map((binding) => binding.trim())
      .filter((binding) => binding && binding !== "logPageRequestIdInDev");
    const quote = analyticsImport[2];
    const repairedAnalyticsImport = bindings.length
      ? `import { ${bindings.join(", ")} } from ${quote}@originloom/shared/lib/analytics/data-layer${quote};`
      : "";
    next = next.replace(analyticsImportPattern, repairedAnalyticsImport);
  }
  return patchClientEntry(next);
}

function patchBoundaryErrorReference(source) {
  if (/RouteErrorPage\s*\([^)]*errorId/.test(source) || source.includes("Referans: {errorId}")) {
    return source;
  }
  const signature =
    "export function RouteErrorPage({ error }: { error: RouteError | null; status: number }) {";
  const message =
    '      <p className="text-slate-600">{error?.message ?? "Lütfen daha sonra tekrar deneyin."}</p>';
  if (!source.includes(signature) || !source.includes(message)) return source;

  return source
    .replace(
      'import type { RouteError } from "@originloom/react/lib/types";',
      'import type { RouteErrorBoundaryProps } from "@originloom/react/lib/types";',
    )
    .replace(
      signature,
      "export function RouteErrorPage({ error, errorId }: RouteErrorBoundaryProps) {",
    )
    .replace(
      message,
      `${message}\n      <p className="text-xs text-slate-500">Referans: {errorId}</p>`,
    );
}

function patchViteConfig(source) {
  return source.includes("__dirname")
    ? source.replaceAll("__dirname", "import.meta.dirname")
    : source;
}

function patchDevReloadConfig(source) {
  const generatedAllowlist =
    /^(\s*)reload:\s*\{\s*\n\s*shouldReload:\s*\(file\)\s*=>\s*\n(?:\s*file\.(?:includes|endsWith)\([^\n]+\),?(?:\s*\|\|)?\s*\n)+\1\},/m;
  return source.replace(generatedAllowlist, "$1reload: {},");
}

function setDependency(manifest, changes, section, name, expected) {
  const previous = manifest[section][name];
  if (previous === expected) return;
  manifest[section][name] = expected;
  changes.push({
    file: "package.json",
    kind: section === "engines" ? "engine" : section === "scripts" ? "script" : "dependency",
    detail: `${section}.${name}: ${previous ?? "yok"} → ${expected}`,
  });
}

export function pendingMigrations(metadata, target = TOOLING_VERSION) {
  const applied = new Set(metadata?.appliedMigrations ?? []);
  return migrations.filter(
    (migration) =>
      compareVersions(migration.introducedIn, target) <= 0 && !applied.has(migration.id),
  );
}
