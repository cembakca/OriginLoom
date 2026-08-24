import { existsSync, globSync, readFileSync } from "node:fs";
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
export const CACHE_PERFORMANCE_ACCEPTANCE_MIGRATION = "0.7.23-cache-performance-acceptance";
export const WARM_PATH_PERFORMANCE_MIGRATION = "0.7.24-warm-path-performance";
export const NODE_24_MIGRATION = "0.7.26-node-24";
export const DEVTOOLS_OPTION_MIGRATION = "0.7.32-devtools-client-option";
export const SHUTDOWN_DRAIN_ORDER_MIGRATION = "0.7.32-shutdown-drain-order";
export const DISPOSABLE_GATEWAY_MIGRATION = "0.7.34-disposable-gateway-response";
export const JSON_SCHEMA_CONTRACTS_MIGRATION = "0.7.52-json-schema-contracts";
export const PLATFORM_PLUMBING_MIGRATION = "0.7.56-platform-plumbing";

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
    migrateProject(root, changes, fileWrites, manualRequired) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "server/product/boundary-pages.tsx",
        patchBoundaryErrorReference,
        manualRequired,
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
  {
    id: CACHE_PERFORMANCE_ACCEPTANCE_MIGRATION,
    introducedIn: "0.7.23",
    description:
      "Adds the memory-first cache correctness gate, opt-in Redis regression matrix and separate identity/gzip capacity profiles.",
    migratePackage(manifest, changes) {
      if (typeof manifest.scripts?.capacity !== "string") return;
      manifest.scripts ??= {};
      setDependency(
        manifest,
        changes,
        "scripts",
        "cache:acceptance",
        "node load-test/cache-acceptance.mjs --topology memory",
      );
      setDependency(
        manifest,
        changes,
        "scripts",
        "cache:acceptance:redis",
        "node load-test/cache-acceptance.mjs --topology redis",
      );
      setDependency(
        manifest,
        changes,
        "scripts",
        "capacity:gzip",
        "node load-test/capacity.mjs --compression gzip",
      );
      setDependency(
        manifest,
        changes,
        "scripts",
        "performance:gate",
        "node load-test/cache-acceptance.mjs --topology memory && node load-test/capacity.mjs --strict",
      );
    },
    migrateProject(root, changes, fileWrites) {
      if (!existsSync(join(root, "load-test/capacity.mjs"))) return;
      for (const relPath of [
        "load-test/cache-acceptance.mjs",
        "load-test/cache-worker.mjs",
        "docs/cache-performance-acceptance.md",
      ]) {
        if (existsSync(join(root, relPath))) continue;
        fileWrites[relPath] = migrationAsset(relPath);
        changes.push({
          file: relPath,
          kind: "add",
          detail: "Cache performance acceptance asset'i eklendi; mevcut kapasite dosyası korunur.",
        });
      }
    },
  },
  {
    id: NODE_24_MIGRATION,
    introducedIn: "0.7.26",
    description:
      "Node 24 (Active LTS, 2028-04-30'a kadar destekli) tabana alınır; taban 24.18.1 — Node 24'ün en güncel güvenlik sürümü. Node 22 2025-10-21'den beri maintenance'ta, yani yalnız kritik düzeltme alıyor. `@types/node` da 24'e çekilir: tipler runtime'ın önünde olduğunda, o runtime'da bulunmayan bir API temiz derlenip çalışma anında patlar.",
    migratePackage(manifest, changes) {
      manifest.engines ??= {};
      setDependency(manifest, changes, "engines", "node", ">=24.18.1");
      if (typeof manifest.devDependencies?.["@types/node"] === "string") {
        setDependency(manifest, changes, "devDependencies", "@types/node", "^24.13.3");
      }
    },
  },
  {
    id: DEVTOOLS_OPTION_MIGRATION,
    introducedIn: "0.7.32",
    description:
      "Dev-only devtools paneli uygulamanın kendi tercihi olur: client entry bir OriginLoomClientOptions bloğu taşır ve dinamik import o bayrağın arkasına alınır, böylece kapatıldığında panel development modül grafiğine de girmez.",
    migrateProject(root, changes, fileWrites, manualRequired) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "src/entry.client.tsx",
        patchClientEntryDevtoolsOption,
        manualRequired,
      );
    },
  },
  {
    id: SHUTDOWN_DRAIN_ORDER_MIGRATION,
    introducedIn: "0.7.32",
    description:
      "Kapanış iki faza ayrılır. Sunucu kapatma ve drain'ler tek bir Promise.all içinde koştuğunda, kapanış anında hâlâ kabul edilen bir istek after() işini drain kendi anlık görüntüsünü aldıktan sonra park edebiliyordu; artık önce dinleyiciler kapanır, sonra drain başlar.",
    migrateProject(root, changes, fileWrites, manualRequired) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "server/index.ts",
        patchShutdownDrainOrder,
        manualRequired,
      );
    },
  },
  {
    id: DISPOSABLE_GATEWAY_MIGRATION,
    introducedIn: "0.7.34",
    description:
      "Gateway yanıtları `await using` ile kapatılabilir hale gelir: tsconfig `lib` listesine ESNext.Disposable eklenir ve uygulamanın kendi gateway adapter'ı çekirdeğin GatewayResponse tipini olduğu gibi geçirir. Mevcut try/finally çağrıları aynen çalışmaya devam eder — bu migration yeni yazımı mümkün kılar, eskisini bozmaz.",
    migrateProject(root, changes, fileWrites, manualRequired) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "tsconfig.json",
        patchDisposableLib,
        manualRequired,
      );
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "server/diagnostics/gateway.ts",
        patchGatewayAdapterResponseType,
      );
    },
  },
  {
    id: JSON_SCHEMA_CONTRACTS_MIGRATION,
    introducedIn: "0.7.52",
    description:
      "Consumer contract şemaları OpenAPI zarfından çıkarılıp düz JSON Schema'ya taşınır: contracts/openapi.json → contracts/gateway-schemas.json, components.schemas → $defs, manifest pointer'ları buna göre yeniden yazılır. Zarfı hiçbir şey okumuyordu — kontrol eden araç yalnız şema tanımlarına bakıyor, endpoint'in method'u ve path'i zaten manifest'te.",
    migrateProject(root, changes, fileWrites, manualRequired) {
      migrateContractSchemas(root, changes, fileWrites, manualRequired);
    },
  },
  {
    id: PLATFORM_PLUMBING_MIGRATION,
    introducedIn: "0.7.56",
    description:
      "Kopyalanan iki altyapı parçası pakete taşınır: server/diagnostics/* → @originloom/core (gateway artık çağrısını kendi kaydediyor, request-trace paketten geliyor) ve server/lib/bff-{http,auth}.ts → @originloom/core/bff. İkisi de saf altyapıydı, sıfır ürün içeriği; her uygulamada ayrı ayrı çürüyorlardı.",
    migrateProject(root, changes, fileWrites, manualRequired) {
      rewritePlatformPlumbingImports(root, changes, fileWrites);
      dropCopiedPlumbing(root, changes, fileWrites, manualRequired);
    },
  },
  {
    id: WARM_PATH_PERFORMANCE_MIGRATION,
    introducedIn: "0.7.24",
    description:
      "Kapasite/performans gate'i autocannon'ın gerçekten ürettiği p97.5 percentile'ını kullanır (p95 hiç var olmamıştı) ve warm-path cache okuması span/histogram yerine ucuz sayaç kullanır.",
    migrateProject(root, changes, fileWrites) {
      patchProjectFile(
        root,
        changes,
        fileWrites,
        "performance-policy.json",
        patchPerformancePolicy,
      );
    },
  },
];

// `patch` may return either a plain string (legacy contract: unchanged output means
// "nothing to do", patched vs. already-applied are not distinguished) or a tagged
// outcome `{ status: "patched" | "already-applied" | "manual-required", source?, detail? }`.
// The tagged contract exists so a file that merely doesn't match the known generated
// pattern is never silently treated the same as one that was already migrated —
// callers that need that distinction (e.g. custom boundary-pages.tsx, OR1) pass a
// `manualRequired` array to collect entries that must NOT be marked applied.
function patchProjectFile(root, changes, fileWrites, relativePath, patch, manualRequired) {
  const path = join(root, relativePath);
  if (!existsSync(path)) return;
  // Several migrations may safely touch the same generated file in one run.
  // Compose from the staged result instead of letting the last patch erase the first.
  const source = fileWrites[relativePath] ?? readFileSync(path, "utf8");
  const outcome = patch(source);

  if (typeof outcome === "string") {
    if (outcome === source) return;
    fileWrites[relativePath] = outcome;
    changes.push({
      file: relativePath,
      kind: "patch",
      detail: "Bilinen generated kalıp güvenli ve idempotent biçimde güncellendi.",
    });
    return;
  }

  if (outcome.status === "already-applied") return;

  if (outcome.status === "manual-required") {
    manualRequired?.push({ file: relativePath, detail: outcome.detail });
    changes.push({ file: relativePath, kind: "manual-required", detail: outcome.detail });
    return;
  }

  fileWrites[relativePath] = outcome.source;
  changes.push({
    file: relativePath,
    kind: "patch",
    detail: outcome.detail ?? "Bilinen generated kalıp güvenli ve idempotent biçimde güncellendi.",
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

const DEVTOOLS_OPTIONS_IMPORT =
  'import type { OriginLoomClientOptions } from "@originloom/shared/lib/client/options";';

const DEVTOOLS_OPTIONS_BLOCK = `const originLoomOptions: OriginLoomClientOptions = {
  devtools: true,
};
const devtoolsEnabled = originLoomOptions.devtools ?? true;`;

const DEVTOOLS_MOUNT_BLOCK = `// Dev-only and lazily imported. Set devtools to false above to keep the panel
// out of the development module graph as well.
if (import.meta.env.DEV && devtoolsEnabled) {
  void import("@originloom/shared/lib/client/devtools").then(({ mountDevtoolsPanel }) =>
    mountDevtoolsPanel({ enabled: devtoolsEnabled }),
  );
}`;

const ISLAND_RUNTIME_IMPORT =
  /^import \{ runIslandBootstrap \} from (["'])@originloom\/shared\/lib\/client\/island-runtime\1;$/m;

/**
 * Puts the devtools panel behind an app-owned flag.
 *
 * An entry that already mounts the panel only needs the flag threaded through
 * the guard it already has; one generated before 0.7.32 has no panel at all and
 * gets the whole block. Both end at the same shape, so a project that adopted
 * devtools by hand and one that never saw them converge here.
 */
function patchClientEntryDevtoolsOption(source) {
  if (source.includes("OriginLoomClientOptions")) return { status: "already-applied" };

  const installCall = "installReloadButtons();";
  if (!ISLAND_RUNTIME_IMPORT.test(source) || !source.includes(installCall)) {
    return {
      status: "manual-required",
      detail:
        "src/entry.client.tsx bilinen generated kalıba uymuyor. OriginLoomClientOptions bloğunu " +
        "ve mountDevtoolsPanel({ enabled: devtoolsEnabled }) çağrısını elle ekleyin.",
    };
  }

  let next = source.replace(ISLAND_RUNTIME_IMPORT, (line) => `${line}\n${DEVTOOLS_OPTIONS_IMPORT}`);
  next = next.replace(installCall, () => `${DEVTOOLS_OPTIONS_BLOCK}\n\n${installCall}`);

  if (next.includes("@originloom/shared/lib/client/devtools")) {
    next = next
      .replace("if (import.meta.env.DEV) {", "if (import.meta.env.DEV && devtoolsEnabled) {")
      .replace("mountDevtoolsPanel()", "mountDevtoolsPanel({ enabled: devtoolsEnabled })");
  } else {
    const telemetryCall = "logPageRequestIdInDev();";
    const mountAfter = next.includes(telemetryCall) ? telemetryCall : installCall;
    next = next.replace(mountAfter, () => `${mountAfter}\n\n${DEVTOOLS_MOUNT_BLOCK}`);
  }

  return {
    status: "patched",
    source: next,
    detail: "Devtools paneli app-owned bir OriginLoomClientOptions bayrağının arkasına alındı.",
  };
}

const CLOSE_THEN_DRAIN =
  /await Promise\.all\(\[\s*closeServer\([A-Za-z0-9_]+\)\s*,\s*closeServer\([A-Za-z0-9_]+\)\s*,?\s*\]\);/;

/**
 * Splits shutdown into a close phase and a drain phase.
 *
 * While the two share one `Promise.all`, a request accepted during shutdown can
 * park an `after()` task *after* the drain has taken its snapshot, and that task
 * is then dropped on exit. Closing the listeners first removes the window.
 */
function patchShutdownDrainOrder(source) {
  const combined = [
    ...source.matchAll(/^([ \t]*)await Promise\.all\(\[\n([\s\S]*?)\n\1\]\);$/gm),
  ].find(([, , body]) => /\bcloseServer\(/.test(body) && /\bdrain[A-Za-z]*\(/.test(body));

  if (!combined) {
    if (CLOSE_THEN_DRAIN.test(source)) return { status: "already-applied" };
    return {
      status: "manual-required",
      detail:
        "server/index.ts kapanışı bilinen generated kalıba uymuyor. closeServer çağrılarını " +
        "drain çağrılarından ayrı ve onlardan önce await edin.",
    };
  }

  const [whole, indent, body] = combined;
  const entries = body.split("\n").filter((line) => line.trim());
  if (entries.some((line) => line.trim().startsWith("//"))) {
    return {
      status: "manual-required",
      detail:
        "Kapanış Promise.all'ı yorum satırı içeriyor; sırayı elle ayırın: önce closeServer, " +
        "sonra drain çağrıları.",
    };
  }

  const closes = entries.filter((line) => line.includes("closeServer("));
  const drains = entries.filter((line) => !line.includes("closeServer("));
  if (closes.length === 0 || drains.length === 0) {
    return {
      status: "manual-required",
      detail:
        "Kapanış Promise.all'ında ayrılacak bir closeServer/drain çifti bulunamadı; sırayı " +
        "elle gözden geçirin.",
    };
  }

  // Prettier collapses a short array and expands a long one, so the migration
  // has to emit the shape it would have produced or the app fails format:check.
  const inline = `${indent}await Promise.all([${closes
    .map((line) => line.trim().replace(/,$/, ""))
    .join(", ")}]);`;
  const closePhase =
    inline.length <= 100
      ? inline
      : `${indent}await Promise.all([\n${closes.join("\n")}\n${indent}]);`;

  const replacement =
    `${indent}// Stop accepting work first: no request may still be able to park an\n` +
    `${indent}// after() task while the drains take their snapshot.\n` +
    `${closePhase}\n` +
    `${indent}await Promise.all([\n${drains.join("\n")}\n${indent}]);`;

  return {
    status: "patched",
    source: source.replace(whole, () => replacement),
    detail: "Kapanış iki faza ayrıldı: önce dinleyiciler kapanır, sonra drain'ler başlar.",
  };
}

const DISPOSABLE_LIB = "ESNext.Disposable";

/**
 * Adds the disposable lib without reformatting the file.
 *
 * A hand-edited tsconfig is the app's, and a JSON round-trip would reflow every
 * comment and every choice of quoting in it. Splicing the one entry in beside
 * the ES lib it belongs next to leaves the rest byte-identical.
 */
function patchDisposableLib(source) {
  if (source.includes(DISPOSABLE_LIB)) return { status: "already-applied" };
  const lib = /("lib"\s*:\s*\[)([^\]]*)(\])/.exec(source);
  if (!lib || lib.index === undefined) {
    return {
      status: "manual-required",
      detail:
        'tsconfig.json içinde bir "lib" dizisi bulunamadı. `await using` için listeye ' +
        '"ESNext.Disposable" ekleyin.',
    };
  }
  const entries = lib[2];
  const quote = entries.includes("'") && !entries.includes('"') ? "'" : '"';
  const patched = entries.replace(
    /(['"])(ES\d{4}|ESNext)\1/,
    (match) => `${match}, ${quote}${DISPOSABLE_LIB}${quote}`,
  );
  if (patched === entries) {
    return {
      status: "manual-required",
      detail:
        'tsconfig.json "lib" listesinde tanınan bir ES sürümü yok. ' +
        '"ESNext.Disposable" girdisini elle ekleyin.',
    };
  }
  return {
    status: "patched",
    source:
      source.slice(0, lib.index) +
      lib[1] +
      patched +
      lib[3] +
      source.slice(lib.index + lib[0].length),
    detail: "tsconfig lib listesine ESNext.Disposable eklendi.",
  };
}

/**
 * Stops the app's own gateway adapter from erasing the disposable type.
 *
 * The wrapper exists to record upstream calls, not to change the contract — but
 * a declared `Promise<Response>` is exactly what makes `await using` reject at
 * the call site, and the error points at the service rather than at the wrapper
 * that caused it.
 */
function patchGatewayAdapterResponseType(source) {
  if (source.includes("GatewayResponse")) return { status: "already-applied" };
  const declaration =
    /(export (?:async )?function (?:gatewayFetch|gatewayFetchWithIdentity|gatewayFetchForRequest)\([^)]*\): Promise<)Response(>)/g;
  const patched = source.replace(declaration, "$1coreGateway.GatewayResponse$2");
  if (patched === source) return source;
  return {
    status: "patched",
    source: patched,
    detail: "Gateway adapter çekirdeğin GatewayResponse tipini olduğu gibi geçiriyor.",
  };
}

/**
 * Moves the contract schemas out of their OpenAPI envelope.
 *
 * Two files change together and a half-applied rename is worse than none — the
 * manifest would point at a document that is no longer there — so this stages
 * both writes or neither, and says so when it cannot.
 */
function migrateContractSchemas(root, changes, fileWrites, manualRequired) {
  const legacyPath = join(root, "contracts/openapi.json");
  const manifestPath = join(root, "contracts/gateway-contracts.json");
  if (!existsSync(legacyPath)) return;

  let legacy;
  try {
    legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
  } catch {
    manualRequired.push({
      file: "contracts/openapi.json",
      detail:
        "Dosya okunamadı; şemaları elle contracts/gateway-schemas.json içine $defs olarak taşıyın.",
    });
    return;
  }

  const schemas = legacy?.components?.schemas;
  if (!schemas || Object.keys(schemas).length === 0) {
    manualRequired.push({
      file: "contracts/openapi.json",
      detail:
        "components.schemas bulunamadı; dönüştürülecek bir şey yok, dosyayı elle gözden geçirin.",
    });
    return;
  }

  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: rewriteSchemaPointers(schemas),
  };
  fileWrites["contracts/gateway-schemas.json"] = `${JSON.stringify(document, null, 2)}\n`;
  fileWrites["contracts/openapi.json"] = null;
  changes.push({
    file: "contracts/gateway-schemas.json",
    kind: "add",
    detail: "OpenAPI zarfı kaldırıldı; şemalar $defs altına taşındı.",
  });
  changes.push({
    file: "contracts/openapi.json",
    kind: "remove",
    detail: "Zarfı hiçbir şey okumuyordu.",
  });

  if (!existsSync(manifestPath)) {
    manualRequired.push({
      file: "contracts/gateway-contracts.json",
      detail:
        "Manifest bulunamadı; schema alanını gateway-schemas.json'a ve pointer'ları #/$defs/ ile başlayacak şekilde elle güncelleyin.",
    });
    return;
  }

  const manifestSource =
    fileWrites["contracts/gateway-contracts.json"] ?? readFileSync(manifestPath, "utf8");
  const patched = manifestSource
    .replaceAll('"openapi.json"', '"gateway-schemas.json"')
    .replaceAll("#/components/schemas/", "#/$defs/");
  if (patched !== manifestSource) {
    fileWrites["contracts/gateway-contracts.json"] = patched;
    changes.push({
      file: "contracts/gateway-contracts.json",
      kind: "patch",
      detail: "Şema dosyası ve pointer'lar yeni konuma çevrildi.",
    });
  }
}

function rewriteSchemaPointers(value) {
  if (Array.isArray(value)) return value.map(rewriteSchemaPointers);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "$ref" && typeof entry === "string"
        ? entry.replace("#/components/schemas/", "#/$defs/")
        : rewriteSchemaPointers(entry),
    ]),
  );
}

function patchBoundaryErrorReference(source) {
  if (/RouteErrorPage\s*\([^)]*errorId/.test(source) || source.includes("Referans: {errorId}")) {
    return { status: "already-applied" };
  }
  const signature =
    "export function RouteErrorPage({ error }: { error: RouteError | null; status: number }) {";
  const message =
    '      <p className="text-slate-600">{error?.message ?? "Lütfen daha sonra tekrar deneyin."}</p>';
  const importStatement = 'import type { RouteError } from "@originloom/react/lib/types";';
  if (
    !source.includes(signature) ||
    !source.includes(message) ||
    !source.includes(importStatement)
  ) {
    return {
      status: "manual-required",
      detail:
        "server/product/boundary-pages.tsx bilinen generated kalıba uymuyor (custom dosya); " +
        "RouteErrorPage bileşeni elle errorId prop'unu (RouteErrorBoundaryProps) almalı ve " +
        "kullanıcıya PII içermeyen bir referans olarak göstermelidir.",
    };
  }

  const next = source
    .replace(
      importStatement,
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
  return { status: "patched", source: next };
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

/**
 * autocannon reports the hdr-histogram-percentiles-obj set, which goes
 * 90 -> 97.5 with no p95 at all. Every generated app's capacity gate read
 * `result.latency.p95`, got `undefined`, and fell through to p97_5 — so the
 * threshold named `latencyP95IncreasePercent` has always been applied to a
 * p97.5 measurement. Renaming the key is what makes the policy file say what
 * the gate actually does; the numeric value is deliberately preserved, so the
 * gate's strictness does not change, only its honesty.
 *
 * Idempotent: an already-renamed policy is left untouched, and a policy
 * carrying neither key is not ours to rewrite.
 */
function patchPerformancePolicy(source) {
  let policy;
  try {
    policy = JSON.parse(source);
  } catch {
    return {
      status: "manual-required",
      detail:
        "performance-policy.json parse edilemedi; `regression.latencyP95IncreasePercent` " +
        "anahtarını elle `latencyP97_5IncreasePercent` olarak yeniden adlandırın.",
    };
  }
  const regression = policy?.regression;
  if (!regression || typeof regression !== "object") return { status: "already-applied" };
  if (!("latencyP95IncreasePercent" in regression)) return { status: "already-applied" };

  // Rebuild the object so the renamed key keeps its original position rather
  // than being appended, which keeps the diff to a single line.
  policy.regression = Object.fromEntries(
    Object.entries(regression).map(([key, value]) =>
      key === "latencyP95IncreasePercent" ? ["latencyP97_5IncreasePercent", value] : [key, value],
    ),
  );
  return {
    status: "patched",
    source: `${JSON.stringify(policy, null, 2)}\n`,
    detail:
      "regression.latencyP95IncreasePercent → latencyP97_5IncreasePercent (eşik değeri korunur; " +
      "autocannon p95 üretmez, ölçüm baştan beri p97.5 idi).",
  };
}

/**
 * Import specifiers that used to point at a copy in the app and now point at
 * the package. The copies were pure infrastructure — a recorder, a gateway
 * wrapper, four BFF response helpers — so nothing here can be product code
 * that merely happens to live at that path.
 */
const PLUMBING_IMPORT_REWRITES = [
  ["@server/diagnostics/ssr-diagnostics", "@originloom/core/diagnostics/request-trace"],
  ["@server/diagnostics/gateway", "@originloom/core/adapters/gateway"],
  ["@server/lib/bff-http", "@originloom/core/bff"],
  ["@server/lib/bff-auth", "@originloom/core/bff"],
];

const PLUMBING_SOURCE_GLOBS = ["server/**/*.{ts,tsx}", "src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"];

/**
 * Rewrites the specifiers in place, everywhere they appear.
 *
 * Import *order* is deliberately left alone: `simple-import-sort` moves
 * `@originloom/core/bff` up into the package group, and reproducing its
 * grouping here would be a second implementation of a rule the app already
 * runs. `pnpm lint:fix` sorts them in one pass, and the migration report says
 * so.
 */
function rewritePlatformPlumbingImports(root, changes, fileWrites) {
  for (const pattern of PLUMBING_SOURCE_GLOBS) {
    for (const relativePath of globSync(pattern, { cwd: root })) {
      const path = join(root, relativePath);
      const source = fileWrites[relativePath] ?? readFileSync(path, "utf8");
      let next = source;
      for (const [from, to] of PLUMBING_IMPORT_REWRITES) {
        next = next.replaceAll(`"${from}"`, `"${to}"`).replaceAll(`'${from}'`, `'${to}'`);
      }
      // `bindRequestPath` lost its request argument when it moved: the platform
      // reads the request from its own async context now.
      next = dropFirstArgument(next, "bindRequestPath");
      if (next === source) continue;
      fileWrites[relativePath] = next;
      changes.push({
        file: relativePath,
        kind: "patch",
        detail: "kopyalanan altyapı import'ları @originloom/core'a yönlendirildi",
      });
    }
  }
}

/**
 * Removes the copies themselves — but only when the file still looks like the
 * one the template generated.
 *
 * An app that grew its own code inside these files is not something a migration
 * may delete, so an unrecognised file is reported for a human instead. The
 * marker for each is an export the generated version has always had.
 */
const COPIED_PLUMBING = [
  ["server/diagnostics/ssr-diagnostics.ts", "export function logSsrOutcome"],
  ["server/diagnostics/gateway.ts", "export async function gatewayFetch"],
  ["server/lib/bff-http.ts", "export function bffJson"],
  ["server/lib/bff-auth.ts", "export async function requireBffAuth"],
];

function dropCopiedPlumbing(root, changes, fileWrites, manualRequired) {
  for (const [relativePath, marker] of COPIED_PLUMBING) {
    const path = join(root, relativePath);
    if (!existsSync(path)) continue;
    if (!readFileSync(path, "utf8").includes(marker)) {
      manualRequired?.push({
        file: relativePath,
        detail:
          "Dosya üretilen halinden farklı; içindekini @originloom/core karşılığıyla " +
          "karşılaştırıp elle silin.",
      });
      continue;
    }
    fileWrites[relativePath] = null;
    changes.push({
      file: relativePath,
      kind: "remove",
      detail: "platform paketine taşındı",
    });
  }
}

/**
 * Removes the first argument from every call to `name`.
 *
 * Written as a scan rather than a regular expression because the argument that
 * survives routinely contains parentheses of its own — the real call site was
 * `bindRequestPath(ctx.request, ctx.publicPath ?? new URL(ctx.request.url).pathname)`,
 * and a regex that stops at the first `)` truncates it into something that
 * still parses and means the wrong thing.
 */
function dropFirstArgument(source, name) {
  let result = "";
  let index = 0;
  for (;;) {
    const start = source.indexOf(`${name}(`, index);
    if (start === -1) return result + source.slice(index);
    const open = start + name.length;
    let depth = 0;
    let comma = -1;
    let close = -1;
    for (let cursor = open; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === "(" || character === "[" || character === "{") depth += 1;
      else if (character === ")" || character === "]" || character === "}") {
        depth -= 1;
        if (depth === 0) {
          close = cursor;
          break;
        }
      } else if (character === "," && depth === 1 && comma === -1) comma = cursor;
    }
    // Unbalanced, or a single-argument call that has already been migrated.
    if (close === -1 || comma === -1) {
      result += source.slice(index, open + 1);
      index = open + 1;
      continue;
    }
    result += source.slice(index, open + 1) + source.slice(comma + 1, close).trim();
    index = close;
  }
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
