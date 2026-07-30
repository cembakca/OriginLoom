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
];

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
