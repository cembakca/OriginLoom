#!/usr/bin/env node
import { readFileSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { applyScaffold, detectProjectLayout } from "./lib/scaffold-gateway/apply.mjs";
import {
  buildScaffoldArtifacts,
  defaultContractKey,
  defaultGatewayPropertyKey,
  defaultSchemaName,
} from "./lib/scaffold-gateway/generate.mjs";

// Fixtures are illustrative sample payloads, not bulk data — a stray huge file or
// accidental `cat bigfile | origin-scaffold-gateway` should fail fast with a clear
// limit instead of buffering an unbounded amount of memory before JSON.parse.
const MAX_FIXTURE_BYTES = 5 * 1024 * 1024;

const options = parseArgs(process.argv.slice(2));
const sample = readSample(options);
const layout = detectProjectLayout(options.cwd);

if (!layout.hasGatewayContracts) {
  fail(
    "server/services/gateway-contracts.ts bulunamadı. origin-scaffold-gateway yalnızca OriginLoom uygulama projelerinde çalışır.",
  );
}

const schemaName = options.schema ?? defaultSchemaName(options.id);
const contractKey = options.contractKey ?? defaultContractKey(options.id);
const gatewayPropertyKey = options.gatewayPropertyKey ?? defaultGatewayPropertyKey(options.id);
const serviceName = options.service ?? options.id;
const operationId = options.operationId ?? options.id.replace(/-/g, ".");

const artifacts = buildScaffoldArtifacts({
  id: options.id,
  path: options.path,
  method: options.method,
  operationId,
  schemaName,
  contractKey,
  gatewayPropertyKey,
  serviceName,
  fetch: options.fetch,
  sample,
});

if (options.json) {
  console.log(JSON.stringify(artifacts, null, 2));
  process.exit(0);
}

if (options.apply) {
  const result = applyScaffold(layout.root, artifacts, {
    consumerContracts: layout.hasConsumerContracts && !options.serviceOnly,
    contractsOnly: options.contractsOnly,
    force: options.force,
  });
  console.log("origin-scaffold-gateway apply\n");
  if (result.written.length) {
    console.log("Written:");
    for (const file of result.written) console.log(`  + ${file}`);
  }
  if (result.skipped.length) {
    console.log("\nSkipped:");
    for (const file of result.skipped) console.log(`  - ${file}`);
  }
  console.log("\nNext:");
  for (const step of artifacts.checklist) console.log(`  • ${step}`);
  process.exit(0);
}

console.log("origin-scaffold-gateway (dry-run)\n");
console.log(`Contract ${options.id} → ${schemaName}Response (${options.fetch} fetch)\n`);
for (const [path, content] of Object.entries(artifacts.files)) {
  if (options.serviceOnly && path.startsWith("contracts/")) continue;
  console.log(`--- ${path} ---`);
  console.log(content.trimEnd());
  console.log("");
}
console.log("--- patch: server/services/gateway-contracts.ts ---");
console.log(artifacts.patches.gatewayContractLine);
if (layout.hasConsumerContracts && !options.serviceOnly) {
  console.log("\n--- patch: contracts/gateway-contracts.json ---");
  console.log(JSON.stringify(artifacts.patches.manifestEntry, null, 2));
  console.log("\n--- patch: contracts/openapi.json ---");
  console.log(JSON.stringify(artifacts.patches.openApiFragment, null, 2));
}
console.log("\nChecklist:");
for (const step of artifacts.checklist) console.log(`  • ${step}`);
console.log("\nApply with: origin-scaffold-gateway ... --apply");

function readSample(options) {
  if (options.fixture) {
    const path = resolve(options.cwd, options.fixture);
    // Checked before the read, not after: a size check against an already-buffered
    // file provides no memory protection at all.
    assertWithinByteLimit(statSync(path).size, options.fixture);
    const buffer = readFileSync(path);
    return parseJson(buffer.toString("utf8"), options.fixture);
  }
  if (!process.stdin.isTTY) {
    const raw = readStdinBounded().toString("utf8").trim();
    if (!raw) fail("Fixture JSON gerekli: --fixture veya stdin.");
    return parseJson(raw, "stdin");
  }
  fail("Fixture JSON gerekli: --fixture path.json veya pipe ile stdin.");
}

function assertWithinByteLimit(byteLength, label) {
  if (byteLength > MAX_FIXTURE_BYTES) {
    fail(
      `${label} maksimum fixture boyutunu (${MAX_FIXTURE_BYTES} byte) aşıyor (${byteLength} byte).`,
    );
  }
}

// Reads fd 0 in bounded chunks instead of a single readFileSync(0) call: the cap is
// enforced as data arrives (no unbounded buffering of a mistakenly huge pipe), and a
// short EAGAIN retry-with-backoff works around synchronous reads from a non-blocking
// pipe (observed when a parent process feeds stdin through a pipe, e.g. spawnSync's
// `input` option) instead of surfacing a raw EAGAIN error.
function readStdinBounded() {
  const chunks = [];
  let total = 0;
  const chunk = Buffer.alloc(65536);
  let eagainRetries = 0;
  for (;;) {
    let bytesRead;
    try {
      bytesRead = readSync(0, chunk, 0, chunk.length, null);
    } catch (error) {
      if (error && error.code === "EOF") break;
      if (error && error.code === "EAGAIN" && eagainRetries < 200) {
        eagainRetries++;
        sleepSync(5);
        continue;
      }
      throw error;
    }
    if (bytesRead === 0) break;
    eagainRetries = 0;
    total += bytesRead;
    assertWithinByteLimit(total, "stdin");
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${label} geçerli JSON değil: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseArgs(argv) {
  const parsed = {
    cwd: process.cwd(),
    id: undefined,
    path: undefined,
    method: "GET",
    schema: undefined,
    contractKey: undefined,
    gatewayPropertyKey: undefined,
    service: undefined,
    operationId: undefined,
    fixture: undefined,
    fetch: "identity",
    apply: false,
    force: false,
    json: false,
    serviceOnly: false,
    contractsOnly: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--cwd") parsed.cwd = requireValue(argv, ++index, arg);
    else if (arg === "--id") parsed.id = requireValue(argv, ++index, arg);
    else if (arg === "--path") parsed.path = requireValue(argv, ++index, arg);
    else if (arg === "--method") parsed.method = requireValue(argv, ++index, arg).toUpperCase();
    else if (arg === "--schema") parsed.schema = requireValue(argv, ++index, arg);
    else if (arg === "--contract-key") parsed.contractKey = requireValue(argv, ++index, arg);
    else if (arg === "--gateway-key") parsed.gatewayPropertyKey = requireValue(argv, ++index, arg);
    else if (arg === "--service") parsed.service = requireValue(argv, ++index, arg);
    else if (arg === "--operation-id") parsed.operationId = requireValue(argv, ++index, arg);
    else if (arg === "--fixture") parsed.fixture = requireValue(argv, ++index, arg);
    else if (arg === "--fetch") parsed.fetch = requireValue(argv, ++index, arg);
    else if (arg === "--apply") parsed.apply = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--service-only") parsed.serviceOnly = true;
    else if (arg === "--contracts-only") parsed.contractsOnly = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else fail(`Unknown option: ${arg}`);
  }

  if (!parsed.id || !parsed.path) {
    printHelp();
    fail("--id and --path are required.");
  }
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(parsed.method)) {
    fail(`Unsupported method: ${parsed.method}`);
  }
  if (!["identity", "auth", "plain"].includes(parsed.fetch)) {
    fail(`--fetch must be identity, auth, or plain (received ${parsed.fetch}).`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(parsed.id)) {
    fail("--id must be kebab-case (e.g. finance-widgets).");
  }
  if (!parsed.path.startsWith("/")) {
    fail("--path must start with /.");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  origin-scaffold-gateway --id <kebab-id> --path </gateway/path> [--fixture sample.json]
  cat response.json | origin-scaffold-gateway --id menu --path /pages/menuitem/list

Options:
  --cwd <dir>            Project root (default: cwd)
  --method GET           HTTP method (default: GET)
  --schema FooBar        OpenAPI schema name (default: derived from --id)
  --contract-key foo_bar defineGatewayContract id (default: snake_case id)
  --gateway-key fooBar     GatewayContracts property (default: camelCase id)
  --service foo-bar      Service + contract file stem (default: --id)
  --operation-id a.b.c   Manifest operationId (default: id with dots)
  --fetch identity       identity | auth | plain (default: identity)
  --service-only         Skip contracts/* when consumer manifest is absent
  --contracts-only       Only write contracts/*: for an endpoint whose
                         service and GatewayContracts entry already exist
  --apply                Write files instead of printing dry-run output
  --force                Overwrite existing scaffold files
  --json                 Emit machine-readable plan
`);
}

function requireValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined) fail(`${flagName} requires a value.`);
  return value;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
