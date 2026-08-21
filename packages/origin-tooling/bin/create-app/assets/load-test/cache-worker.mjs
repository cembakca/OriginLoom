#!/usr/bin/env node
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import { resolve } from "node:path";

let cache;
let resourceApi;
const resources = new Map();

try {
  const requireFromApp = createRequire(resolve(process.cwd(), "package.json"));
  cache = await import(requireFromApp.resolve("@originloom/core/cache"));
  resourceApi = await import(requireFromApp.resolve("@originloom/core/cache/resource"));
  await cache.initCache();
  send({ type: "ready", topology: cache.cacheTopology() });
} catch (error) {
  send({ type: "fatal", error: errorMessage(error) });
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

if (!process.exitCode) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let command;
    try {
      command = JSON.parse(line);
      const result = await execute(command);
      send({ id: command.id, ok: true, result });
      if (command.operation === "close") break;
    } catch (error) {
      send({ id: command?.id, ok: false, error: errorMessage(error) });
    }
  }
}

async function execute(command) {
  switch (command.operation) {
    case "burst": {
      const resource = getResource(command);
      const started = performance.now();
      const results = await Promise.all(
        Array.from({ length: command.count }, () =>
          resource.get(command.parts, (context) => load(command, context)),
        ),
      );
      return {
        elapsedMs: performance.now() - started,
        results: results.map(summarizeResult),
      };
    }
    case "get": {
      const started = performance.now();
      const result = await getResource(command).get(command.parts, (context) =>
        load(command, context),
      );
      return { elapsedMs: performance.now() - started, result: summarizeResult(result) };
    }
    case "invalidate":
      return { deleted: await getResource(command).invalidate(command.parts) };
    case "invalidate-tags":
      return cache.invalidateTags(command.tags);
    case "drain":
      return { drained: await resourceApi.drainCachedResourceRevalidations(command.timeoutMs) };
    case "health":
      return { healthy: await cache.pingCache(), topology: cache.cacheTopology() };
    case "close":
      await resourceApi.drainCachedResourceRevalidations(2_000);
      await cache.closeCache();
      return { closed: true };
    default:
      throw new Error(`unknown worker operation: ${command.operation}`);
  }
}

function getResource(command) {
  const definition = command.resource;
  const identity = JSON.stringify(definition);
  let resource = resources.get(identity);
  if (!resource) {
    resource = resourceApi.defineCachedResource({
      namespace: definition.namespace,
      version: definition.version,
      ttl: definition.ttl,
      swr: definition.swr,
      staleIfError: definition.staleIfError,
      negativeTtl: definition.negativeTtl,
      timeoutMs: definition.timeoutMs ?? 5_000,
      tags: definition.tags,
      parse: parseValue,
    });
    resources.set(identity, resource);
  }
  return resource;
}

async function load(command, context) {
  const url = new URL("/load", command.upstreamUrl);
  url.searchParams.set("scenario", command.scenario);
  url.searchParams.set("mode", command.mode ?? "value");
  url.searchParams.set("value", String(command.value ?? 1));
  url.searchParams.set("bytes", String(command.bytes ?? 0));
  const response = await fetch(url, { signal: context.signal });
  if (response.status === 404) return resourceApi.cachedResourceNotFound();
  if (response.status === 204) return resourceApi.cachedResourceNoContent();
  if (!response.ok) throw new Error(`acceptance upstream HTTP ${response.status}`);
  return resourceApi.cachedResourceValue(parseValue(await response.json()));
}

function parseValue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.value !== "number" ||
    typeof value.payload !== "string"
  ) {
    throw new Error("invalid acceptance value");
  }
  return { value: value.value, payload: value.payload };
}

function summarizeResult(result) {
  return {
    kind: result.kind,
    cacheState: result.cacheState,
    ...(result.kind === "value" ? { value: result.value.value } : {}),
    ...(result.staleIfError ? { staleIfError: true } : {}),
  };
}

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
