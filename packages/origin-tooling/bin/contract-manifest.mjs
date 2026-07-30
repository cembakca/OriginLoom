import Ajv2020 from "ajv/dist/2020.js";

const IDENTIFIER = "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$";
const ENV_NAME = "^CONTRACT_[A-Z0-9_]+$";
const METHOD = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const headerValueSchema = {
  oneOf: [
    {
      type: "object",
      required: ["value"],
      properties: { value: { type: "string", maxLength: 1_000 } },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["env"],
      properties: { env: { type: "string", pattern: ENV_NAME } },
      additionalProperties: false,
    },
  ],
};

const requestBodySchema = {
  type: "object",
  required: ["fixture", "schema"],
  properties: {
    fixture: { type: "string", minLength: 1 },
    schema: { type: "string", pattern: "^#/" },
    contentType: { type: "string", minLength: 1 },
    envBindings: {
      type: "object",
      propertyNames: { pattern: "^/" },
      additionalProperties: { type: "string", pattern: ENV_NAME },
    },
  },
  additionalProperties: false,
};

const legacyContractSchema = {
  type: "object",
  required: ["id", "path", "fixture", "schema"],
  properties: {
    id: { type: "string", minLength: 1 },
    path: { type: "string", pattern: "^/" },
    fixture: { type: "string", minLength: 1 },
    schema: { type: "string", pattern: "^#/" },
    method: { type: "string", enum: METHOD },
    status: { type: "integer", minimum: 100, maximum: 599 },
  },
  additionalProperties: true,
};

const manifestV1Schema = {
  type: "object",
  required: ["schema", "contracts"],
  properties: {
    schemaVersion: { const: 1 },
    schema: { type: "string", minLength: 1 },
    contracts: { type: "array", minItems: 1, items: legacyContractSchema },
  },
  additionalProperties: true,
};

const authProfileSchema = {
  type: "object",
  required: ["type", "tokenEnv"],
  properties: {
    type: { const: "bearer" },
    tokenEnv: { type: "string", pattern: ENV_NAME },
  },
  additionalProperties: false,
};

const manifestV2Schema = {
  type: "object",
  required: ["schemaVersion", "schema", "contracts"],
  properties: {
    schemaVersion: { const: 2 },
    schema: { type: "string", minLength: 1 },
    authProfiles: {
      type: "object",
      propertyNames: { pattern: IDENTIFIER },
      additionalProperties: authProfileSchema,
    },
    contracts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "operationId", "request", "response"],
        properties: {
          id: { type: "string", pattern: IDENTIFIER },
          operationId: { type: "string", pattern: IDENTIFIER },
          request: {
            type: "object",
            required: ["method", "path"],
            properties: {
              method: { type: "string", enum: METHOD },
              path: { type: "string", pattern: "^/" },
              auth: { type: "string", pattern: IDENTIFIER },
              headers: {
                type: "object",
                propertyNames: { pattern: "^[A-Za-z0-9-]+$" },
                additionalProperties: headerValueSchema,
              },
              body: requestBodySchema,
            },
            additionalProperties: false,
          },
          response: {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "integer", minimum: 100, maximum: 599 },
              contentType: { type: "string", minLength: 1 },
              schema: { type: "string", pattern: "^#/" },
              fixture: { type: "string", minLength: 1 },
            },
            dependentRequired: { schema: ["fixture"], fixture: ["schema"] },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateV1 = ajv.compile(manifestV1Schema);
const validateV2 = ajv.compile(manifestV2Schema);

export function normalizeContractManifest(input) {
  const version = input?.schemaVersion ?? 1;
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported contract manifest schemaVersion: ${String(version)}`);
  }
  const validate = version === 2 ? validateV2 : validateV1;
  if (!validate(input)) {
    const details = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`Contract manifest v${version} is invalid: ${details}`);
  }

  const duplicateId = findDuplicate(input.contracts.map(({ id }) => id));
  if (duplicateId) throw new Error(`Contract manifest contains duplicate id: ${duplicateId}`);

  const authProfiles = version === 2 ? (input.authProfiles ?? {}) : {};
  if (version === 2) {
    for (const contract of input.contracts) {
      const auth = contract.request.auth;
      if (auth && !Object.hasOwn(authProfiles, auth)) {
        throw new Error(`Contract ${contract.id} references unknown auth profile: ${auth}`);
      }
      if (["GET", "HEAD"].includes(contract.request.method) && contract.request.body) {
        throw new Error(
          `Contract ${contract.id} cannot define a body for ${contract.request.method}`,
        );
      }
      for (const header of Object.keys(contract.request.headers ?? {})) {
        if (["authorization", "cookie"].includes(header.toLowerCase())) {
          throw new Error(
            `Contract ${contract.id} must use an auth profile instead of request header ${header}`,
          );
        }
      }
      if (contract.response.contentType && !contract.response.fixture) {
        throw new Error(
          `Contract ${contract.id} cannot require response contentType without a response fixture`,
        );
      }
    }
  }

  return {
    schemaVersion: version,
    schema: input.schema,
    authProfiles,
    contracts: input.contracts.map((contract) =>
      version === 2
        ? { ...contract, legacyAuth: false }
        : {
            id: contract.id,
            operationId: contract.id,
            request: {
              method: contract.method ?? "GET",
              path: contract.path,
            },
            response: {
              status: contract.status ?? 200,
              schema: contract.schema,
              fixture: contract.fixture,
            },
            legacyAuth: true,
          },
    ),
  };
}

function findDuplicate(values) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}
