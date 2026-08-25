#!/usr/bin/env node
/**
 * What only a real deployment shape can prove.
 *
 * The container smoke boots one pod against a Redis that is not there and passes
 * with `CACHE_REQUIRED=false` — so what it proves is that the app survives
 * without Redis, which is worth knowing and is not what production does. None of
 * the guarantees this platform actually sells are visible from one process:
 *
 *   - a shared HTML cache is only shared if a *second* pod reads what the first wrote
 *   - "at most once per key" is a claim about two pods, not one
 *   - a rate limit that resets per pod is not a rate limit
 *   - and the whole point of the release/app namespace split is what happens
 *     mid rolling deploy, when two releases of the same app are up at once
 *
 * So: one real Redis, one gateway, three app processes. Two of them share a
 * release; the third is the next one, started while the first two are still
 * serving. Everything asserted here failed at least once while it was written.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const appRoot = resolve(root, "apps/showroom");
const entry = resolve(appRoot, "dist/server/index.js");
const gatewayEntry = resolve(appRoot, "tests/fixtures/gateway/server.js");

const REDIS_URL = process.env.REDIS_URL?.trim();
if (!REDIS_URL) fail("REDIS_URL is required: this check exists to exercise a real one.");
if (!existsSync(entry)) fail(`${entry} not found; run pnpm build first.`);

const GATEWAY_PORT = 4102;
// Unique per run, both of them. A fixed release id would let one run's cache
// entries answer the next run's questions — which is how the rolling-deploy
// check passed once before it was correct.
const RUN = `${Date.now()}-${process.pid}`;
const APP_ID = `topology-${RUN}`;
const RELEASE_A = `release-n-${RUN}`;
const RELEASE_B = `release-n-plus-1-${RUN}`;
// A rotation, as a deployment performs it: add the new secret everywhere while
// keeping the old one, then drop the old one.
const ISLAND_SECRET_OLD = "topology-island-secret-old-0123456789";
const ISLAND_SECRET_NEW = "topology-island-secret-new-9876543210";

const children = [];
const failures = [];
let checks = 0;

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

const gateway = start("gateway", [gatewayEntry], {
  MOCK_GATEWAY_PORT: String(GATEWAY_PORT),
  MOCK_GW_QUIET: "1",
});
await waitFor(`http://127.0.0.1:${GATEWAY_PORT}/healthz`, "gateway");
void gateway;

// Two pods of the same release, exactly as a Deployment runs them.
const podA = await startPod("pod-a", 3110, RELEASE_A);
const podB = await startPod("pod-b", 3120, RELEASE_A);

/**
 * Readiness under the production contract, which the container smoke cannot
 * reach: with `CACHE_REQUIRED=true` a pod that cannot see Redis must refuse to
 * report ready, so a pod that *does* report ready has proven the connection.
 */
await check("both pods become ready with CACHE_REQUIRED=true", async () => {
  for (const pod of [podA, podB]) {
    const response = await fetch(`${pod.url}/readyz`);
    assert(response.ok, `${pod.name} /readyz returned ${response.status}`);
  }
});

await check("the second pod serves what the first one cached", async () => {
  const path = "/bankalar/akbank";
  await fetch(`${podA.url}${path}`);
  const onA = await fetch(`${podA.url}${path}`);
  assert(onA.headers.get("x-cache") === "HIT", `pod-a did not fill its own cache`);

  const onB = await fetch(`${podB.url}${path}`);
  assert(
    onB.headers.get("x-cache") === "HIT",
    `pod-b saw x-cache=${onB.headers.get("x-cache")}; the L2 entry is not shared`,
  );
});

await check("one idempotency key runs the work once across pods", async () => {
  await resetCounters();
  const key = `topology-${Date.now()}`;
  await subscribe(podA, key);
  await subscribe(podB, key);

  const { newsletterSubscribes } = await counters();
  assert(
    newsletterSubscribes === 1,
    `the gateway saw ${newsletterSubscribes} subscribe calls for one key`,
  );
});

/**
 * The half of the namespace split that only a rolling deploy exercises.
 *
 * `RELEASE_ID` moves, so the next release must not inherit the old one's HTML —
 * and must still honour the old one's idempotency records, because during the
 * rollout those two releases are the two parties that have to agree.
 */
const podC = await startPod("pod-c", 3130, RELEASE_B, {
  // Mid-rotation: signs with the new key, still accepts the old one.
  SERVER_ISLAND_SECRET: ISLAND_SECRET_NEW,
  SERVER_ISLAND_PREVIOUS_SECRET: ISLAND_SECRET_OLD,
});

await check("the next release does not serve the previous release's cached HTML", async () => {
  const response = await fetch(`${podC.url}/bankalar/akbank`);
  assert(
    response.headers.get("x-cache") !== "HIT",
    "pod-c served the previous release's cache entry",
  );
});

await check("the next release still honours the previous release's idempotency key", async () => {
  await resetCounters();
  const key = `rolling-${Date.now()}`;
  await subscribe(podA, key);
  await subscribe(podC, key);

  const { newsletterSubscribes } = await counters();
  assert(
    newsletterSubscribes === 1,
    `the gateway saw ${newsletterSubscribes} subscribe calls across the deploy boundary`,
  );
});

/**
 * The rotation, end to end, which no unit test can reach.
 *
 * A server island placeholder is signed once and then sits inside cached HTML
 * that outlives the request — and outlives the deploy. Mid rolling deploy the
 * pod that signed it and the pod asked to fill it are different releases holding
 * different secrets, and a single-secret setup means every hole in every already
 * rendered page comes back empty for the length of the rollout.
 */
const podD = await startPod("pod-d", 3140, RELEASE_B, {
  // The rotation has finished: the old key is gone.
  SERVER_ISLAND_SECRET: ISLAND_SECRET_NEW,
});

await check("a placeholder signed before the rotation is still filled during it", async () => {
  const payload = await islandPayloadFrom(podA);
  const response = await fetch(`${podC.url}/api/_island?p=${encodeURIComponent(payload)}&path=/`);
  await response.body?.cancel();

  assert(response.status === 200, `pod-c answered ${response.status} for the previous key`);
});

/** Retiring a key is the point of naming it; once off the ring it is refused. */
await check("and refused once the rotation has finished", async () => {
  const payload = await islandPayloadFrom(podA);
  const response = await fetch(`${podD.url}/api/_island?p=${encodeURIComponent(payload)}&path=/`);
  await response.body?.cancel();

  assert(response.status === 400, `pod-d answered ${response.status} for a retired key`);
});

report();

async function startPod(name, port, releaseId, secrets = {}) {
  const url = `http://127.0.0.1:${port}`;
  start(name, ["--enable-source-maps", entry], {
    NODE_ENV: "production",
    APP_ENV: "production",
    PORT: String(port),
    METRICS_PORT: String(port + 900),
    SITE_URL: url,
    GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
    ALLOW_INSECURE_GATEWAY: "true",
    RELEASE_ID: releaseId,
    // One app, whatever the release: this is the value the coordination
    // namespace is built from.
    APP_ID,
    AUTH_REFRESH_COORDINATION_SECRET: "topology-auth-refresh-coordination-secret",
    CACHE_PURGE_SECRET: "topology-cache-purge-secret",
    REFERRAL_STATS_SECRET: "topology-referral-stats-secret",
    MARKET_STREAM_TOKEN: "topology-market-stream-token",
    CACHE_BACKEND: "redis",
    // The production contract, and the reason this check exists: readiness now
    // depends on Redis actually answering.
    CACHE_REQUIRED: "true",
    REDIS_URL,
    ALLOW_INSECURE_REDIS: "true",
    SUPPORT_EMAIL: "topology@example.invalid",
    SERVER_ISLAND_SECRET: ISLAND_SECRET_OLD,
    ...secrets,
  });
  await waitFor(`${url}/readyz`, name);
  return { name, url };
}

/** The newsletter form, posted the way a browser posts it. */
async function subscribe(pod, key) {
  // The field names the form actually renders, not the ones a reader would
  // guess: `_islem` is the idempotency slot the shell stamps per render, and
  // `onay` is the consent box the validator requires — without it the route
  // answers 422 and never reaches the work this check is counting.
  const body = new URLSearchParams({
    eposta: "topology@example.invalid",
    ad: "Topoloji",
    onay: "on",
    _islem: key,
  });
  const response = await fetch(`${pod.url}/bulten`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // The mutation guard refuses a cross-site form post, and it is right to.
      // These are the headers a browser attaches to its own form; sending them
      // is what makes this a test of coordination rather than of the guard.
      origin: pod.url,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
    body,
    redirect: "manual",
  });
  await response.body?.cancel();
  assert(response.status < 400, `${pod.name} refused the subscription with ${response.status}`);
  return response;
}

/** The signed placeholder a rendered page carries, straight out of its HTML. */
async function islandPayloadFrom(pod) {
  const response = await fetch(`${pod.url}/server-island`);
  const html = await response.text();
  const match = /data-payload="([^"]+)"/.exec(html);
  assert(match !== null, `${pod.name} rendered no signed island placeholder`);
  return match[1];
}

async function counters() {
  const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/__fixture/counters`);
  return response.json();
}

async function resetCounters() {
  const response = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/__fixture/counters/reset`, {
    method: "POST",
  });
  await response.body?.cancel();
}

function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const output = [];
  child.stderr.on("data", (chunk) => {
    output.push(String(chunk));
    if (output.length > 40) output.shift();
  });
  children.push({ name, child, output });
  return child;
}

async function waitFor(url, name, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // Expected until the listener binds.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The reason it never came up is in its own output, not in a timeout message.
  const entry = children.find((candidate) => candidate.name === name);
  const reason = entry?.output.join("").trim();
  fail(`${name} was not ready within ${timeoutMs}ms${reason ? `\n\n${reason}` : ""}`);
}

async function check(label, body) {
  checks += 1;
  try {
    await body();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  ✗ ${label}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function report() {
  console.log(`\n${checks - failures.length}/${checks} topoloji kontrolü geçti`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  shutdown(failures.length > 0 ? 1 : 0);
}

function shutdown(code) {
  for (const { child } of children) child.kill("SIGTERM");
  process.exit(code);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  shutdown(1);
}
