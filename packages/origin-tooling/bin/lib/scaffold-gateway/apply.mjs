import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * @param {string} root
 * @param {ReturnType<import('./generate.mjs').buildScaffoldArtifacts>} artifacts
 * `contractsOnly` is the mirror of `serviceOnly`, and it exists for the case an
 * app reaches once it has been running for a while: the endpoint is already
 * read, the service and its `GatewayContracts` entry are written and hand-tuned,
 * and the only thing missing is the schema that would catch the gateway
 * renaming a field. Without it the scaffolder would offer a duplicate service
 * next to the real one and a second contract line, and covering an existing
 * endpoint would mean hand-writing the schema — which is the thing this command
 * exists to avoid.
 *
 * @param {{ consumerContracts?: boolean; contractsOnly?: boolean; force?: boolean }} options
 */
export function applyScaffold(root, artifacts, options = {}) {
  const consumerContracts = options.consumerContracts !== false;
  const contractsOnly = options.contractsOnly === true;
  const written = [];
  const skipped = [];

  for (const [relPath, content] of Object.entries(artifacts.files)) {
    if (!consumerContracts && relPath.startsWith("contracts/")) {
      skipped.push(relPath);
      continue;
    }
    if (contractsOnly && !relPath.startsWith("contracts/")) {
      skipped.push(relPath);
      continue;
    }
    const absPath = join(root, relPath);
    if (existsSync(absPath) && !options.force) {
      skipped.push(relPath);
      continue;
    }
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
    written.push(relPath);
  }

  const gatewayContractsPath = join(root, "server/services/gateway-contracts.ts");
  if (contractsOnly) {
    skipped.push("server/services/gateway-contracts.ts (contracts-only)");
  } else if (existsSync(gatewayContractsPath)) {
    const updated = patchGatewayContracts(
      readFileSync(gatewayContractsPath, "utf8"),
      artifacts.patches.gatewayContractLine,
      artifacts.spec.contractKey,
      artifacts.spec.gatewayPropertyKey,
    );
    if (updated.changed) {
      writeFileSync(gatewayContractsPath, updated.content);
      written.push(relative(root, gatewayContractsPath));
    }
  } else {
    skipped.push("server/services/gateway-contracts.ts (missing)");
  }

  if (consumerContracts) {
    const manifestPath = join(root, "contracts/gateway-contracts.json");
    const openApiPath = join(root, "contracts/openapi.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!manifest.contracts.some((entry) => entry.id === artifacts.patches.manifestEntry.id)) {
        manifest.contracts.push(artifacts.patches.manifestEntry);
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        written.push(relative(root, manifestPath));
      }
    } else {
      skipped.push("contracts/gateway-contracts.json (missing)");
    }

    if (existsSync(openApiPath)) {
      const openApi = JSON.parse(readFileSync(openApiPath, "utf8"));
      const { path, method, operation, schemaName, schema } = artifacts.patches.openApiFragment;
      openApi.paths ??= {};
      openApi.paths[path] ??= {};
      openApi.paths[path][method] = operation;
      openApi.components ??= {};
      openApi.components.schemas ??= {};
      openApi.components.schemas[schemaName] = schema;
      writeFileSync(openApiPath, `${JSON.stringify(openApi, null, 2)}\n`);
      written.push(relative(root, openApiPath));
    } else {
      skipped.push("contracts/openapi.json (missing)");
    }
  }

  return { written, skipped };
}

/**
 * @param {string} source
 * @param {string} line
 * @param {string} contractKey
 */
export function patchGatewayContracts(source, line, contractKey, gatewayPropertyKey = contractKey) {
  if (
    source.includes(`defineGatewayContract("${contractKey}"`) ||
    source.includes(`${gatewayPropertyKey}: defineGatewayContract(`)
  ) {
    return { changed: false, content: source };
  }
  const marker = "} as const;";
  const index = source.lastIndexOf(marker);
  if (index === -1) {
    return { changed: false, content: source };
  }
  const content = `${source.slice(0, index)}${line}\n${source.slice(index)}`;
  return { changed: true, content };
}

/** @param {string} cwd */
export function detectProjectLayout(cwd) {
  const root = resolve(cwd);
  return {
    root,
    hasGatewayContracts: existsSync(join(root, "server/services/gateway-contracts.ts")),
    hasConsumerContracts: existsSync(join(root, "contracts/gateway-contracts.json")),
  };
}
