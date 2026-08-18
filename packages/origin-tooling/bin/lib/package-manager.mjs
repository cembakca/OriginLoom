import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLING_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** @typedef {"pnpm" | "npm" | "yarn"} PackageManager */

export const PACKAGE_MANAGERS = /** @type {const} */ (["pnpm", "npm", "yarn"]);
export const PNPM_VERSION = "11.18.0";
export const NPM_VERSION = "11.18.0";
export const YARN_VERSION = "4.9.2";

const LOCKFILES = {
  pnpm: "pnpm-lock.yaml",
  npm: "package-lock.json",
  yarn: "yarn.lock",
};

const TRUSTED_NATIVE_BUILDS = [
  "@tailwindcss/oxide",
  "esbuild",
  "libxmljs2",
  "protobufjs",
  "sharp",
  "unrs-resolver",
];

export const trustedNativeBuildPackages = [...TRUSTED_NATIVE_BUILDS];

/** @param {string} packageName */
export function pnpmAllowBuildYamlKey(packageName) {
  return packageName.startsWith("@") ? `"${packageName}"` : packageName;
}

const AUTOCANNON_HYPERID_OVERRIDE = "^4.0.0";

/** Transitive production-audit pins for the platform monorepo and generated apps. */
export const PNPM_DEPENDENCY_OVERRIDES = {
  "autocannon>hyperid": AUTOCANNON_HYPERID_OVERRIDE,
  "fast-uri": "^3.1.5",
  "xmlbuilder2>js-yaml": "^4.3.1",
  nanoid: "^3.3.18",
  postcss: "^8.5.23",
};

/** @type {Record<string, string>} */
export const YARN_RESOLUTIONS = {
  "autocannon/hyperid": AUTOCANNON_HYPERID_OVERRIDE,
  "fast-uri": "^3.1.5",
  "xmlbuilder2/js-yaml": "^4.3.1",
  nanoid: "^3.3.18",
  postcss: "^8.5.23",
};

/** YAML body (no `overrides:` header) for pnpm-workspace.yaml. */
export function pnpmDependencyOverridesYaml() {
  return Object.entries(PNPM_DEPENDENCY_OVERRIDES)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join("\n");
}

function findInstalledPackageDir(packageName, startDir) {
  let current = resolve(startDir);
  for (;;) {
    const packageJsonPath = join(current, "node_modules", packageName, "package.json");
    if (existsSync(packageJsonPath)) return dirname(packageJsonPath);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`${packageName} is not installed (searched from ${startDir})`);
}

function resolveCyclonedxNpmCli() {
  const packageDir = findInstalledPackageDir("@cyclonedx/cyclonedx-npm", TOOLING_ROOT);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const binEntry = manifest.bin;
  const relativePath =
    typeof binEntry === "string"
      ? binEntry
      : (binEntry?.["cyclonedx-npm"] ?? "bin/cyclonedx-npm-cli.js");
  const cliPath = join(packageDir, relativePath);
  if (!existsSync(cliPath)) {
    throw new Error(`@cyclonedx/cyclonedx-npm CLI not found at ${cliPath}`);
  }
  return cliPath;
}

/**
 * @param {string | undefined} field
 * @returns {PackageManager | undefined}
 */
export function parsePackageManagerField(field) {
  if (typeof field !== "string" || field.length === 0) return undefined;
  const id = field.split("@")[0];
  return PACKAGE_MANAGERS.includes(/** @type {PackageManager} */ (id))
    ? /** @type {PackageManager} */ (id)
    : undefined;
}

/**
 * @param {string} cwd
 * @param {PackageManager | undefined} override
 * @returns {PackageManager | undefined}
 */
export function detectPackageManager(cwd, override) {
  if (override) {
    assertKnownPackageManager(override);
    return override;
  }
  if (existsSync(join(cwd, LOCKFILES.pnpm))) return "pnpm";
  if (existsSync(join(cwd, LOCKFILES.npm))) return "npm";
  if (existsSync(join(cwd, LOCKFILES.yarn))) return "yarn";
  return undefined;
}

/**
 * @param {string} cwd
 * @param {{
 *   override?: PackageManager;
 *   metadata?: { packageManager?: string };
 *   packageJson?: { packageManager?: string };
 * }} [options]
 */
export function resolvePackageManager(cwd, options = {}) {
  const declared =
    (typeof options.metadata?.packageManager === "string"
      ? options.metadata.packageManager
      : undefined) ??
    parsePackageManagerField(options.packageJson?.packageManager);
  const detected = detectPackageManager(cwd, options.override);
  return declared ?? detected ?? "pnpm";
}

/** @param {PackageManager} pm */
export function lockfileFor(pm) {
  return LOCKFILES[pm];
}

/** @param {string} pm */
export function assertKnownPackageManager(pm) {
  if (!PACKAGE_MANAGERS.includes(/** @type {PackageManager} */ (pm))) {
    throw new Error(`Unknown package manager: ${pm}. Expected one of ${PACKAGE_MANAGERS.join(", ")}`);
  }
}

/** @param {PackageManager} pm */
export function packageManagerPin(pm) {
  switch (pm) {
    case "pnpm":
      return `pnpm@${PNPM_VERSION}`;
    case "npm":
      return `npm@${NPM_VERSION}`;
    case "yarn":
      return `yarn@${YARN_VERSION}`;
  }
}

/** @param {PackageManager} pm */
export function installCommand(pm, { frozen = true } = {}) {
  switch (pm) {
    case "pnpm":
      return frozen ? "pnpm install --frozen-lockfile" : "pnpm install";
    case "npm":
      return frozen ? "npm ci" : "npm install";
    case "yarn":
      return frozen ? "yarn install --immutable" : "yarn install";
  }
}

/** @param {PackageManager} pm */
export function auditProdCommand(pm) {
  switch (pm) {
    case "pnpm":
      return "pnpm audit --prod --audit-level=high";
    case "npm":
      return "npm audit --omit=dev --audit-level=high";
    case "yarn":
      return "yarn npm audit --environment production --severity high";
  }
}

/**
 * @param {PackageManager} pm
 * @param {string} script
 * @param {string} [args]
 */
export function runScriptCommand(pm, script, args = "") {
  const suffix = args.length > 0 ? ` ${args}` : "";
  switch (pm) {
    case "pnpm":
      return `pnpm run ${script}${suffix}`;
    case "npm":
      return args.length > 0 ? `npm run ${script} --${suffix}` : `npm run ${script}`;
    case "yarn":
      return `yarn run ${script}${suffix}`;
  }
}

/** @param {PackageManager} pm @param {string} step */
function runCiStep(pm, step) {
  const space = step.indexOf(" ");
  if (space === -1) return runScriptCommand(pm, step);
  return runScriptCommand(pm, step.slice(0, space), step.slice(space + 1));
}

/** @param {PackageManager} pm */
export function ciScript(pm) {
  const steps = [
    "origin:doctor --strict",
    "typecheck",
    "check:cycles",
    "lint",
    "format:check",
    "test",
    "contracts:fixtures",
    "build",
    "budget:bundle",
    "e2e",
    "lighthouse",
    "smoke",
  ];
  return steps.map((step) => runCiStep(pm, step)).join(" && ");
}

/** @param {PackageManager} pm */
export function e2eServerScript(pm) {
  return `${runScriptCommand(pm, "build")} && ${runScriptCommand(pm, "start")}`;
}

/** @param {PackageManager} pm */
export function nativeBuildPolicy(pm) {
  switch (pm) {
    case "pnpm":
      return {};
    case "npm":
      return { onlyBuiltDependencies: [...TRUSTED_NATIVE_BUILDS] };
    case "yarn":
      return {
        resolutions: { ...YARN_RESOLUTIONS },
      };
  }
}

/** @param {PackageManager} pm */
export function dependencyOverrideField(pm) {
  switch (pm) {
    case "pnpm":
      return {};
    case "npm":
      return { overrides: { ...PNPM_DEPENDENCY_OVERRIDES } };
    case "yarn":
      return {};
  }
}

/** @param {string} cwd */
export function isYarnClassic(cwd) {
  const lockPath = join(cwd, LOCKFILES.yarn);
  if (!existsSync(lockPath)) return false;
  const head = readFileSync(lockPath, "utf8").slice(0, 200);
  return !head.includes("__metadata:");
}

/**
 * @param {unknown} bom
 * @param {string} outputPath
 */
export function validateCycloneDxDocument(bom, outputPath) {
  if (
    typeof bom !== "object" ||
    bom === null ||
    /** @type {{ bomFormat?: string }} */ (bom).bomFormat !== "CycloneDX" ||
    /** @type {{ specVersion?: string }} */ (bom).specVersion !== "1.6" ||
    !/** @type {{ metadata?: { component?: unknown } }} */ (bom).metadata?.component ||
    !Array.isArray(/** @type {{ components?: unknown }} */ (bom).components)
  ) {
    throw new Error(`Generated an invalid or unexpected CycloneDX document: ${outputPath}`);
  }
  return /** @type {{ components: unknown[] }} */ (bom);
}

/**
 * @param {PackageManager} pm
 * @param {{
 *   cwd: string;
 *   packageName: string;
 *   outputPath: string;
 *   productionOnly: boolean;
 * }} options
 * @returns {{ command: string; args: string[]; shell?: boolean }}
 */
export function spawnSpecForSbom(pm, { cwd, packageName, outputPath, productionOnly }) {
  switch (pm) {
    case "pnpm":
      return {
        command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        args: [
          "sbom",
          "--filter",
          packageName,
          "--sbom-format",
          "cyclonedx",
          "--sbom-spec-version",
          "1.6",
          "--sbom-type",
          "application",
          "--lockfile-only",
          "--out",
          outputPath,
          ...(productionOnly ? ["--prod"] : []),
        ],
      };
    case "npm": {
      const lockfile = join(cwd, LOCKFILES.npm);
      if (!existsSync(lockfile)) {
        throw new Error(
          `npm SBOM requires ${LOCKFILES.npm}. Run ${installCommand("npm", { frozen: false })} first.`,
        );
      }
      const cyclonedxBin = resolveCyclonedxNpmCli();
      return {
        command: process.execPath,
        args: [
          cyclonedxBin,
          "--package-lock-only",
          "--spec-version",
          "1.6",
          "--output-file",
          outputPath,
          "--mc-type",
          "application",
          ...(productionOnly ? ["--omit", "dev"] : []),
        ],
      };
    }
    case "yarn": {
      const lockfile = join(cwd, LOCKFILES.yarn);
      if (!existsSync(lockfile)) {
        throw new Error(
          `yarn SBOM requires ${LOCKFILES.yarn}. Run ${installCommand("yarn", { frozen: false })} first.`,
        );
      }
      if (isYarnClassic(cwd)) {
        throw new Error(
          "Yarn Classic (v1) lockfiles are not supported for SBOM generation. Migrate to Yarn Berry (>=3) or use npm/pnpm.",
        );
      }
      return {
        command: process.platform === "win32" ? "yarn.cmd" : "yarn",
        args: [
          "dlx",
          "@cyclonedx/yarn-plugin-cyclonedx",
          "--sv",
          "1.6",
          "--output-file",
          outputPath,
          "--mc-type",
          "application",
          ...(productionOnly ? ["--prod"] : []),
        ],
        shell: process.platform === "win32",
      };
    }
  }
}

/**
 * @param {string} argvPmFlag
 * @returns {PackageManager | undefined}
 */
export function parsePmFlag(argv) {
  const index = argv.indexOf("--pm");
  if (index >= 0 && typeof argv[index + 1] === "string") {
    assertKnownPackageManager(argv[index + 1]);
    return /** @type {PackageManager} */ (argv[index + 1]);
  }
  return undefined;
}

/**
 * @param {string} cwd
 * @param {PackageManager} declared
 * @returns {{ ok: boolean; message?: string; severity?: "warning" | "error" }}
 */
export function validateLockfileMatchesManager(cwd, declared) {
  const expected = lockfileFor(declared);
  if (!existsSync(join(cwd, expected))) {
    const present = PACKAGE_MANAGERS.filter((pm) => existsSync(join(cwd, lockfileFor(pm))));
    if (present.length === 0) {
      return {
        ok: false,
        severity: "warning",
        message: `${expected} bulunamadı.`,
      };
    }
    return {
      ok: false,
      severity: "error",
      message: `Metadata packageManager=${declared} ama ${expected} yok (${present.join(", ")} lockfile mevcut).`,
    };
  }
  if (declared === "yarn" && isYarnClassic(cwd)) {
    return {
      ok: false,
      severity: "warning",
      message:
        "Yarn Classic lockfile algılandı. OriginLoom SBOM ve scaffold desteği Yarn Berry (>=3) içindir.",
    };
  }
  return { ok: true };
}

/** @param {string} root */
export function readProjectMetadata(root) {
  const path = join(root, ".originloom/project.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {string} root */
export function readPackageJson(root) {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
}
