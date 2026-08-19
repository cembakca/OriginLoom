import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyScaffold, patchGatewayContracts } from "../bin/lib/scaffold-gateway/apply.mjs";
import {
  buildScaffoldArtifacts,
  defaultContractKey,
  defaultGatewayPropertyKey,
  defaultSchemaName,
  inferSchemaFromSample,
} from "../bin/lib/scaffold-gateway/generate.mjs";

const CLI = fileURLToPath(new URL("../bin/scaffold-gateway.mjs", import.meta.url));
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "origin-scaffold-gateway-"));
  roots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(root, relativePath);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

function runCli(args, { cwd, input = "" } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: "utf8",
  });
}

const samplePayload = {
  widgets: [{ id: "a", label: "Alpha", enabled: true }],
  total: 1,
};

const gatewayContractsSource = `import { defineGatewayContract } from "@originloom/core/gateway-payload";

export const GatewayContracts = {
  items: defineGatewayContract("items", 262_144),
} as const;
`;

const manifestSource = {
  schemaVersion: 2,
  schema: "openapi.json",
  authProfiles: {},
  contracts: [],
};

const openApiSource = {
  openapi: "3.1.0",
  info: { title: "Test", version: "1.0.0" },
  paths: {},
  components: { schemas: {} },
};

describe("scaffold-gateway infer + generate", () => {
  it("derives schema and contract keys from kebab id", () => {
    expect(defaultSchemaName("finance-widgets")).toBe("FinanceWidgets");
    expect(defaultContractKey("finance-widgets")).toBe("finance_widgets");
    expect(defaultGatewayPropertyKey("finance-widgets")).toBe("financeWidgets");
  });

  it("infers object schema from sample payload", () => {
    const inferred = inferSchemaFromSample(samplePayload);
    expect(inferred.schema.type).toBe("object");
    expect(inferred.fields?.map((field) => field.key)).toEqual(["widgets", "total"]);
  });

  it("builds service, types, fixture and manifest patches", () => {
    const artifacts = buildScaffoldArtifacts({
      id: "finance-widgets",
      path: "/finance/widgets?page=1",
      method: "GET",
      operationId: "finance.widgets",
      schemaName: "FinanceWidgets",
      contractKey: "finance_widgets",
      gatewayPropertyKey: "financeWidgets",
      serviceName: "finance-widgets",
      fetch: "identity",
      sample: samplePayload,
    });

    expect(artifacts.files["contracts/fixtures/finance-widgets.json"]).toContain('"total": 1');
    expect(artifacts.files["src/lib/contracts/finance-widgets.ts"]).toContain(
      "export type FinanceWidgetsResponse",
    );
    expect(artifacts.files["server/services/finance-widgets.ts"]).toContain(
      "export async function loadFinanceWidgets(request: Request",
    );
    expect(artifacts.files["server/services/finance-widgets.ts"]).toContain(
      "GatewayContracts.financeWidgets",
    );
    expect(artifacts.patches.gatewayContractLine).toContain(
      'financeWidgets: defineGatewayContract("finance_widgets"',
    );
    expect(artifacts.patches.manifestEntry.id).toBe("finance-widgets");
    expect(artifacts.patches.openApiFragment.path).toBe("/finance/widgets");
  });
});

describe("scaffold-gateway apply", () => {
  it("patches gateway-contracts before the closing brace", () => {
    const line = '  financeWidgets: defineGatewayContract("finance_widgets", 65536),';
    const updated = patchGatewayContracts(gatewayContractsSource, line, "finance_widgets", "financeWidgets");
    expect(updated.changed).toBe(true);
    expect(updated.content).toContain(line);
    expect(updated.content).toContain("} as const;");
  });

  it("writes scaffold files and merges manifest/openapi on apply", () => {
    const root = fixture({
      "server/services/gateway-contracts.ts": gatewayContractsSource,
      "contracts/gateway-contracts.json": `${JSON.stringify(manifestSource, null, 2)}\n`,
      "contracts/openapi.json": `${JSON.stringify(openApiSource, null, 2)}\n`,
    });

    const artifacts = buildScaffoldArtifacts({
      id: "finance-widgets",
      path: "/finance/widgets",
      method: "GET",
      operationId: "finance.widgets",
      schemaName: "FinanceWidgets",
      contractKey: "finance_widgets",
      gatewayPropertyKey: "financeWidgets",
      serviceName: "finance-widgets",
      fetch: "identity",
      sample: samplePayload,
    });

    const result = applyScaffold(root, artifacts, { consumerContracts: true });
    expect(result.written).toContain("contracts/fixtures/finance-widgets.json");
    expect(result.written).toContain("server/services/finance-widgets.ts");
    expect(result.written).toContain("src/lib/contracts/finance-widgets.ts");
    expect(readFileSync(join(root, "server/services/gateway-contracts.ts"), "utf8")).toContain(
      "financeWidgets: defineGatewayContract",
    );

    const manifest = JSON.parse(readFileSync(join(root, "contracts/gateway-contracts.json"), "utf8"));
    expect(manifest.contracts).toHaveLength(1);
    expect(manifest.contracts[0].id).toBe("finance-widgets");

    const openApi = JSON.parse(readFileSync(join(root, "contracts/openapi.json"), "utf8"));
    expect(openApi.paths["/finance/widgets"].get.operationId).toBe("finance.widgets");
    expect(openApi.components.schemas.FinanceWidgets).toBeTruthy();
  });

  it("skips existing files unless force is set", () => {
    const root = fixture({
      "server/services/gateway-contracts.ts": gatewayContractsSource,
      "server/services/finance-widgets.ts": "existing\n",
    });
    const artifacts = buildScaffoldArtifacts({
      id: "finance-widgets",
      path: "/finance/widgets",
      method: "GET",
      operationId: "finance.widgets",
      schemaName: "FinanceWidgets",
      contractKey: "finance_widgets",
      gatewayPropertyKey: "financeWidgets",
      serviceName: "finance-widgets",
      fetch: "identity",
      sample: samplePayload,
    });

    const skipped = applyScaffold(root, artifacts, { consumerContracts: false });
    expect(skipped.skipped).toContain("server/services/finance-widgets.ts");
    expect(readFileSync(join(root, "server/services/finance-widgets.ts"), "utf8")).toBe("existing\n");

    const forced = applyScaffold(root, artifacts, { consumerContracts: false, force: true });
    expect(forced.written).toContain("server/services/finance-widgets.ts");
    expect(readFileSync(join(root, "server/services/finance-widgets.ts"), "utf8")).toContain(
      "loadFinanceWidgets",
    );
  });
});

describe("origin-scaffold-gateway CLI", () => {
  it("prints dry-run output for a fixture file", () => {
    const root = fixture({
      "server/services/gateway-contracts.ts": gatewayContractsSource,
      "sample.json": `${JSON.stringify(samplePayload)}\n`,
    });
    const { status, stdout, stderr } = runCli(
      ["--id", "finance-widgets", "--path", "/finance/widgets", "--fixture", "sample.json"],
      { cwd: root },
    );
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("origin-scaffold-gateway (dry-run)");
    expect(stdout).toContain("server/services/finance-widgets.ts");
    expect(stdout).toContain("financeWidgets: defineGatewayContract");
  });

  it("fails when gateway-contracts.ts is missing", () => {
    const root = fixture({ "sample.json": "{}\n" });
    const { status, stderr } = runCli(
      ["--id", "menu", "--path", "/pages/menu", "--fixture", "sample.json"],
      { cwd: root },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("gateway-contracts.ts");
  });

  it("applies scaffold from stdin", () => {
    const root = fixture({
      "server/services/gateway-contracts.ts": gatewayContractsSource,
      "contracts/gateway-contracts.json": `${JSON.stringify(manifestSource, null, 2)}\n`,
      "contracts/openapi.json": `${JSON.stringify(openApiSource, null, 2)}\n`,
    });
    const { status, stdout } = runCli(
      ["--id", "finance-widgets", "--path", "/finance/widgets", "--apply"],
      { cwd: root, input: JSON.stringify(samplePayload) },
    );
    expect(status).toBe(0);
    expect(stdout).toContain("origin-scaffold-gateway apply");
    expect(existsSync(join(root, "contracts/fixtures/finance-widgets.json"))).toBe(true);
  });
});
