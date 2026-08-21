import {
  defaultContractKey,
  defaultGatewayPropertyKey,
  defaultSchemaName,
  inferSchemaFromSample,
} from "./infer-schema.mjs";

/**
 * @typedef {object} InferredSchema
 * @property {Record<string, unknown>} schema
 * @property {string | null} tsType
 * @property {string} guard
 * @property {number} [stringMaxLength]
 * @property {number} [arrayMaxItems]
 * @property {{ integer?: boolean; min?: number; max?: number }} [numberOptions]
 * @property {InferredSchema} [item]
 * @property {Array<InferredSchema & { key: string }>} [fields]
 */

/** @typedef {'identity' | 'auth' | 'plain'} FetchMode */

/**
 * @param {{
 *   id: string;
 *   path: string;
 *   method: string;
 *   operationId: string;
 *   schemaName: string;
 *   contractKey: string;
 *   gatewayPropertyKey: string;
 *   serviceName: string;
 *   fetch: FetchMode;
 *   sample: unknown;
 * }} spec
 */
export function buildScaffoldArtifacts(spec) {
  const inferredRoot = inferSchemaFromSample(spec.sample);
  const fixtureBytes = Buffer.byteLength(JSON.stringify(spec.sample), "utf8");
  const byteBudget = Math.max(65_536, Math.ceil(fixtureBytes * 4));

  const contractTypesName = `${spec.schemaName}Response`;
  const guardName = `is${spec.schemaName}Response`;
  const loadFnName = `load${spec.schemaName}`;
  const invalidMessage = `${spec.schemaName} gateway returned an invalid payload`;

  const fetchImport =
    spec.fetch === "auth"
      ? "gatewayFetchForRequest"
      : spec.fetch === "plain"
        ? "gatewayFetch"
        : "gatewayFetchWithIdentity";

  const typesSource = renderTypes(contractTypesName, inferredRoot);
  const serviceSource = renderServiceModule({
    fetchImport,
    contractKey: spec.contractKey,
    gatewayPropertyKey: spec.gatewayPropertyKey,
    contractTypesName,
    guardName,
    loadFnName,
    invalidMessage,
    path: spec.path,
    method: spec.method,
    fetch: spec.fetch,
    serviceName: spec.serviceName,
    inferredRoot,
  });

  const openApiPath = spec.path.split("?")[0];
  const openApiFragment = {
    path: openApiPath,
    method: spec.method.toLowerCase(),
    operation: {
      operationId: spec.operationId,
      responses: {
        200: {
          description: `${spec.schemaName} response`,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${spec.schemaName}` },
            },
          },
        },
      },
    },
    schemaName: spec.schemaName,
    schema: inferredRoot.schema,
  };

  const manifestEntry = {
    id: spec.id,
    operationId: spec.operationId,
    request: {
      method: spec.method,
      path: spec.path,
    },
    response: {
      status: 200,
      contentType: "application/json",
      fixture: `fixtures/${spec.id}.json`,
      schema: `#/components/schemas/${spec.schemaName}`,
    },
  };

  const gatewayContractLine = `  ${spec.gatewayPropertyKey}: defineGatewayContract("${spec.contractKey}", ${byteBudget}),`;

  const checklist = [
    "Review generated guards and tighten string/array limits if the sample was minimal.",
    "Strip PII from the fixture before committing.",
    `Wire ${loadFnName}() from a route loader or server service caller.`,
    "Run pnpm contracts:fixtures after apply.",
    "Add a mock-gateway route if you use tests/fixtures/gateway/ for local dev.",
  ];

  return {
    spec,
    byteBudget,
    files: {
      [`contracts/fixtures/${spec.id}.json`]: `${JSON.stringify(spec.sample, null, 2)}\n`,
      [`src/lib/contracts/${spec.serviceName}.ts`]: typesSource,
      [`server/services/${spec.serviceName}.ts`]: serviceSource,
    },
    patches: {
      gatewayContractLine,
      manifestEntry,
      openApiFragment,
    },
    checklist,
  };
}

/** @param {string} contractTypesName @param {InferredSchema} inferred */
function renderTypes(contractTypesName, inferred) {
  const body = renderTsType(inferred, 0);
  return `/** Generated scaffold — review and move shared types if this domain grows. */\nexport type ${contractTypesName} = ${body};\n`;
}

/** @param {InferredSchema} node @param {number} depth */
function renderTsType(node, depth) {
  if (node.tsType && !node.fields) return node.tsType;
  if (!node.fields?.length) return "Record<string, unknown>";
  const indent = "  ".repeat(depth + 1);
  const lines = node.fields.map((field) => {
    const required =
      Array.isArray(node.schema.required) && node.schema.required.includes(field.key);
    const optional = required ? "" : "?";
    return `${indent}${field.key}${optional}: ${renderTsType(field, depth + 1)};`;
  });
  return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`;
}

/** @param {InferredSchema & { key?: string }} node @param {number} [index] */
function helperGuardName(node, index = 0) {
  if (node.key) return `is${capitalize(camelCase(node.key))}`;
  if (node.item) return `isItemElement`;
  return `isNested${index}`;
}

/** @param {InferredSchema} node @param {string} varName @param {Map<InferredSchema, string | null>} names */
function renderGuardBody(node, varName, names) {
  switch (node.guard) {
    case "isBoolean":
      return `typeof ${varName} === "boolean"`;
    case "isSafeInteger":
      return `typeof ${varName} === "number" && Number.isSafeInteger(${varName})`;
    case "isFiniteNumber":
      return `typeof ${varName} === "number" && Number.isFinite(${varName})`;
    case "isBoundedString":
      return `isBoundedString(${varName}, ${node.stringMaxLength ?? 200})`;
    case "isBoundedArrayUnknown":
      return `Array.isArray(${varName}) && ${varName}.length <= ${node.arrayMaxItems ?? 100}`;
    case "isBoundedArray": {
      const itemGuard = node.item ? names.get(node.item) : null;
      return `isBoundedArray(${varName}, ${node.arrayMaxItems ?? 100}, ${itemGuard ?? "(() => true)"})`;
    }
    case "isRecord":
      if (!node.fields?.length) return `isRecord(${varName})`;
      return (
        `isRecord(${varName}) && ` +
        node.fields.map((field) => `${names.get(field)}(${varName}.${field.key})`).join(" && ")
      );
    default:
      return "true";
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function camelCase(value) {
  return value.replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
}

/** @param {object} ctx */
function renderServiceModule(ctx) {
  const names = new Map();
  collectGuardNodes(ctx.inferredRoot, names);

  const helperFns = [...names.entries()]
    .filter(([node, name]) => node !== ctx.inferredRoot && name)
    .map(([node, name]) => {
      const fieldType = node.key
        ? `${ctx.contractTypesName}["${node.key}"]`
        : node.item
          ? "unknown"
          : "unknown";
      return `function ${name}(value: unknown): value is ${fieldType} {
  return ${renderGuardBody(node, "value", names)};
}`;
    });

  const fetchArgs =
    ctx.fetch === "plain"
      ? `\`${ctx.path}\`, { method: "${ctx.method}" }`
      : `request, \`${ctx.path}\`, { method: "${ctx.method}" }`;

  const gatewayImports =
    ctx.fetch === "plain"
      ? `import { gatewayFetch, requireGatewayOk } from "@originloom/core/adapters/gateway";`
      : `import {
  ${ctx.fetchImport},
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";`;

  return `${gatewayImports}
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import {
  isBoundedArray,
  isBoundedString,
  isRecord,
} from "@originloom/shared/lib/runtime-schema";

import type { ${ctx.contractTypesName} } from "~/lib/contracts/${ctx.serviceName}";

import { GatewayContracts } from "./gateway-contracts";

const INVALID = "${ctx.invalidMessage}";

/** Gateway loader scaffold — review fetch mode and error handling before shipping. */
export async function ${ctx.loadFnName}(${ctx.fetch === "plain" ? "" : "request: Request, "}): Promise<${ctx.contractTypesName}> {
  const response = await ${ctx.fetchImport}(${fetchArgs});
  await requireGatewayOk(response, "${ctx.contractTypesName} gateway returned");
  const payload = await readGatewayJson(response, GatewayContracts.${ctx.gatewayPropertyKey}, INVALID);
  return requireGatewayPayload(GatewayContracts.${ctx.gatewayPropertyKey}, payload, ${ctx.guardName}, INVALID);
}

function ${ctx.guardName}(value: unknown): value is ${ctx.contractTypesName} {
  return ${renderGuardBody(ctx.inferredRoot, "value", names)};
}

${helperFns.join("\n\n")}
`;
}

/** @param {InferredSchema} node @param {Map<InferredSchema, string | null>} names */
function collectGuardNodes(node, names) {
  if (!names.has(node)) {
    names.set(node, names.size === 0 ? null : helperGuardName(node, names.size));
  }
  if (node.fields) {
    for (const field of node.fields) {
      collectGuardNodes(field, names);
    }
  }
  if (node.item) collectGuardNodes(node.item, names);
}

export { defaultContractKey, defaultGatewayPropertyKey, defaultSchemaName, inferSchemaFromSample };
