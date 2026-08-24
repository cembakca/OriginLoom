#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import { normalizeContractManifest } from "./contract-manifest.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.requireBaseUrl && !options.baseUrl) {
  fail("CONTRACT_BASE_URL is required for a staging contract check.");
}
const root = resolve(options.cwd);
const configPath = resolve(root, options.config);
if (!existsSync(configPath)) fail(`Contract config not found: ${configPath}`);
let config;
try {
  config = normalizeContractManifest(readJson(configPath, "Contract config"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const schemaPath = resolve(dirname(configPath), config.schema);
if (!existsSync(schemaPath)) fail(`Contract schema not found: ${relative(root, schemaPath)}`);
const schemaDocument = readJson(schemaPath, "Contract schema");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const results = [];

for (const contract of config.contracts ?? []) {
  const requestFixture = contract.request.body
    ? loadFixture(contract, "request", contract.request.body)
    : undefined;
  if (requestFixture?.failed) continue;
  const responseFixture = contract.response.fixture
    ? loadFixture(contract, "response", contract.response)
    : undefined;
  if (responseFixture?.failed) continue;
  if (!options.baseUrl) {
    results.push({ id: contract.id, status: "pass", source: "fixture", drift: [] });
    continue;
  }

  try {
    const request = resolveContractRequest(config, contract, requestFixture);
    const response = await fetch(new URL(contract.request.path, options.baseUrl), {
      method: contract.request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (response.status !== contract.response.status) {
      await response.body?.cancel();
      results.push({
        id: contract.id,
        status: "fail",
        source: "gateway",
        reason: `HTTP ${response.status}`,
      });
      continue;
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (
      contract.response.contentType &&
      contentType !== contract.response.contentType.toLowerCase()
    ) {
      await response.body?.cancel();
      results.push({
        id: contract.id,
        status: "fail",
        source: "gateway",
        reason: `Content-Type ${contentType ?? "missing"}, expected ${contract.response.contentType}`,
      });
      continue;
    }
    if (!responseFixture) {
      const body = await response.text();
      if (body.length > 0) {
        results.push({
          id: contract.id,
          status: "fail",
          source: "gateway",
          reason: `Expected an empty response body, received ${Buffer.byteLength(body)} bytes`,
        });
        continue;
      }
      results.push({ id: contract.id, status: "pass", source: "gateway", drift: [] });
      continue;
    }
    const actual = await response.json();
    const valid = responseFixture.validate(actual);
    if (!valid) {
      results.push({
        id: contract.id,
        status: "fail",
        source: "gateway",
        errors: copyErrors(responseFixture.validate.errors),
      });
      continue;
    }
    const drift = compareShape(responseFixture.value, actual);
    results.push({ id: contract.id, status: "pass", source: "gateway", drift });
  } catch (error) {
    results.push({
      id: contract.id,
      status: "fail",
      source: "gateway",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function loadFixture(contract, direction, definition) {
  const fixturePath = resolve(dirname(configPath), definition.fixture);
  const source = direction === "request" ? "request-fixture" : "fixture";
  if (!existsSync(fixturePath)) {
    results.push({
      id: contract.id,
      status: "fail",
      source,
      reason: `Fixture not found: ${relative(root, fixturePath)}`,
    });
    return { failed: true };
  }
  const value = readJson(fixturePath, `${direction} fixture ${contract.id}`);
  // Compiled with the refs left as refs, so a schema that refers to itself — a
  // menu tree, a comment thread — resolves instead of recursing until the stack
  // ends. Inlining every `$ref` was the old approach and a cyclic schema is a
  // legitimate thing to write.
  const validate = ajv.compile(jsonSchemaFor(schemaDocument, definition.schema));
  if (!validate(value)) {
    results.push({
      id: contract.id,
      status: "fail",
      source,
      errors: copyErrors(validate.errors),
    });
    return { failed: true };
  }
  return { failed: false, value, validate };
}

if (options.json)
  console.log(
    JSON.stringify(
      { manifestVersion: config.schemaVersion, baseUrl: options.baseUrl, results },
      null,
      2,
    ),
  );
else render(results, options.baseUrl, config.schemaVersion);
if (results.some(({ status }) => status === "fail")) process.exit(1);

function compareShape(expected, actual, path = "$", changes = []) {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length > 0 && actual.length > 0)
      compareShape(expected[0], actual[0], `${path}[]`, changes);
    return changes;
  }
  if (isObject(expected) && isObject(actual)) {
    for (const key of Object.keys(expected)) {
      if (!Object.hasOwn(actual, key)) changes.push({ kind: "missing", path: `${path}.${key}` });
      else compareShape(expected[key], actual[key], `${path}.${key}`, changes);
    }
    for (const key of Object.keys(actual)) {
      if (!Object.hasOwn(expected, key))
        changes.push({ kind: "added-compatible", path: `${path}.${key}` });
    }
  }
  return changes;
}

/**
 * The OpenAPI document as something Ajv will compile.
 *
 * Ajv runs in strict mode, and OpenAPI's own envelope (`openapi`, `info`,
 * `paths`, `components`) is not JSON Schema — strict mode rejects each of those
 * as an unknown keyword. Moving the schemas under `$defs` and rewriting the
 * pointers to match is the whole conversion; nothing inside a schema changes,
 * which is what keeps a recursive one working.
 */
function jsonSchemaFor(document, pointer) {
  const defs = document.components?.schemas ?? {};
  return {
    $defs: rewriteRefs(defs),
    $ref: rewritePointer(pointer),
  };
}

function rewritePointer(pointer) {
  return pointer.replace("#/components/schemas/", "#/$defs/");
}

function rewriteRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === "$ref" && typeof entry === "string" ? rewritePointer(entry) : rewriteRefs(entry),
    ]),
  );
}

function render(items, baseUrl, manifestVersion) {
  console.log(
    baseUrl
      ? `Gateway contract check: ${new URL(baseUrl).origin} (manifest v${manifestVersion})`
      : `Gateway fixture contract check (manifest v${manifestVersion})`,
  );
  for (const item of items) {
    console.log(`${item.status === "pass" ? "✓" : "✗"} ${item.id} (${item.source})`);
    for (const drift of item.drift ?? [])
      console.log(
        `  ${drift.kind === "added-compatible" ? "+ compatible" : "- breaking"}: ${drift.path}`,
      );
    for (const error of item.errors ?? [])
      console.log(`  schema ${error.instancePath || "/"}: ${error.message}`);
    if (item.reason) console.log(`  ${item.reason}`);
  }
}

function resolveContractRequest(config, contract, requestFixture) {
  const headers = new Headers();
  if (contract.legacyAuth) {
    if (process.env.CONTRACT_BEARER_TOKEN) {
      headers.set("authorization", `Bearer ${process.env.CONTRACT_BEARER_TOKEN}`);
    }
  } else {
    const profileName = contract.request.auth;
    if (profileName) {
      const profile = config.authProfiles[profileName];
      headers.set(
        "authorization",
        `Bearer ${requiredEnv(profile.tokenEnv, `Auth profile ${profileName}`)}`,
      );
    }
    for (const [name, source] of Object.entries(contract.request.headers ?? {})) {
      headers.set(
        name,
        Object.hasOwn(source, "value")
          ? source.value
          : requiredEnv(source.env, `Request header ${name}`),
      );
    }
  }

  if (!contract.request.body) return { headers };
  const bodyValue = structuredClone(requestFixture.value);
  for (const [pointer, envName] of Object.entries(contract.request.body.envBindings ?? {})) {
    setJsonPointer(bodyValue, pointer, requiredEnv(envName, `Request body binding ${pointer}`));
  }
  if (!requestFixture.validate(bodyValue)) {
    const detail = copyErrors(requestFixture.validate.errors)
      .map((error) => `${error.instancePath || "/"}: ${error.message}`)
      .join("; ");
    throw new Error(`Bound request body for ${contract.id} violates its schema: ${detail}`);
  }
  headers.set("content-type", contract.request.body.contentType ?? "application/json");
  return { headers, body: JSON.stringify(bodyValue) };
}

function requiredEnv(name, context) {
  const value = process.env[name];
  if (!value) throw new Error(`${context} requires environment variable ${name}`);
  return value;
}

function setJsonPointer(document, pointer, value) {
  const parts = pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new Error(`Unsafe request body binding: ${pointer}`);
  }
  let target = document;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(target) && !Array.isArray(target)) {
      throw new Error(`Request body binding does not resolve: ${pointer}`);
    }
    if (!Object.hasOwn(target, part))
      throw new Error(`Request body binding does not resolve: ${pointer}`);
    target = target[part];
  }
  const finalPart = parts.at(-1);
  if ((!isObject(target) && !Array.isArray(target)) || !Object.hasOwn(target, finalPart)) {
    throw new Error(`Request body binding does not resolve: ${pointer}`);
  }
  target[finalPart] = value;
}

function copyErrors(errors) {
  return (errors ?? []).map(({ instancePath, keyword, message, params }) => ({
    instancePath,
    keyword,
    message,
    params,
  }));
}
function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(
      `${description} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseArgs(argv) {
  const parsed = {
    cwd: process.cwd(),
    config: "contracts/gateway-contracts.json",
    baseUrl: process.env.CONTRACT_BASE_URL,
    timeoutMs: 10_000,
    json: false,
    requireBaseUrl: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--cwd") parsed.cwd = argv[++index];
    else if (arg === "--config") parsed.config = argv[++index];
    else if (arg === "--base-url") parsed.baseUrl = argv[++index];
    else if (arg === "--timeout-ms") parsed.timeoutMs = Number(argv[++index]);
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--require-base-url") parsed.requireBaseUrl = true;
    else fail(`Unknown option: ${arg}`);
  }
  return parsed;
}
function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
