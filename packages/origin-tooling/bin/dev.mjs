import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect, createServer } from "node:net";
import { resolve } from "node:path";

import { loadEnv } from "./load-env.mjs";

loadEnv("development");

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const viteUrl = new URL(process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174");
const appUrl = new URL(process.env.SITE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3005"}`);
const gatewayUrl = new URL(process.env.GATEWAY_URL ?? "http://127.0.0.1:4002");
// `--gateway <path>` spawns a local upstream (a mock) alongside the app, the way
// origin-smoke does. Without it, GATEWAY_URL must point at something running.
const gatewayFlagIndex = process.argv.indexOf("--gateway");
const gatewayEntry = gatewayFlagIndex !== -1 ? process.argv[gatewayFlagIndex + 1] : undefined;
const children = new Set();
let stopping = false;

if (viteUrl.protocol !== "http:") {
  throw new Error("origin-dev currently requires an http VITE_DEV_SERVER_URL");
}

function start(label, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  children.add(child);

  child.once("error", (error) => {
    console.error(`[dev:${label}] could not start:`, error);
    shutdown("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.error(`[dev:${label}] exited${signal ? ` with ${signal}` : ` (${code ?? 1})`}`);
    shutdown("SIGTERM", code && code > 0 ? code : 1);
  });
}

function shutdown(signal, exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }

  const force = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5_000);
  force.unref();
}

process.once("SIGINT", () => shutdown("SIGINT", 0));
process.once("SIGTERM", () => shutdown("SIGTERM", 0));

/**
 * Generated assets, on the same opt-in inputs `origin-build` uses. Dev needs them
 * for the same reason the build does: the document references the favicon and OG
 * image by path, and without them the browser reports a 404 on every page.
 */
function generate(label, script) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [new URL(script, import.meta.url).pathname], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", fail);
    child.once("exit", (code) =>
      code === 0 ? settle() : fail(new Error(`${label} exited with code ${code}`)),
    );
  });
}

if (existsSync(resolve(root, "src/assets/svg"))) await generate("icons", "./generate-icons.mjs");
if (existsSync(resolve(root, "server/media.config.json")))
  await generate("media", "./build-media.mjs");

/**
 * Refuse to start on a port something else already holds.
 *
 * Without this the app crashes on EADDRINUSE while the process that owns the
 * port keeps answering — usually an older instance, often one whose directory
 * has since been deleted or rebuilt. The browser then shows a page whose CSS
 * and JS 404, because they are being looked for in a build that is no longer
 * there, and nothing on screen points at the real cause. Every generated app
 * defaults to the same port, so two projects collide the moment both are open.
 */
/** A TCP connect, not a request: the upstream owes this runner no health route. */
function gatewayAnswers(url) {
  return new Promise((settle) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    });
    const done = (answer) => {
      socket.destroy();
      settle(answer);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function portOwner(port) {
  return new Promise((settle) => {
    const probe = createServer();
    probe.once("error", (error) => settle(error.code === "EADDRINUSE" ? "busy" : "free"));
    probe.once("listening", () => probe.close(() => settle("free")));
    // No host, because that is how the servers themselves bind. Probing
    // 127.0.0.1 would miss a process already holding the wildcard address —
    // which is exactly the collision worth catching.
    probe.listen(port);
  });
}

const wanted = [
  { label: "app", url: appUrl },
  { label: "Vite", url: viteUrl },
  ...(gatewayEntry ? [{ label: "gateway", url: gatewayUrl }] : []),
];
const taken = [];
for (const { label, url } of wanted) {
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if ((await portOwner(port)) === "busy") taken.push({ label, port });
}
if (taken.length > 0) {
  for (const { label, port } of taken) {
    console.error(`[dev] port ${port} (${label}) is already in use`);
  }
  console.error(
    "\n  Something is already listening — most likely an older instance of this app,\n" +
      "  or another generated app on the same default port. Stop it, or give this app\n" +
      "  its own ports in .env.development (PORT, VITE_DEV_SERVER_URL, METRICS_PORT).\n\n" +
      `  What holds it:  lsof -ti :${taken[0].port}\n`,
  );
  process.exit(1);
}

console.log(
  `[dev] starting ${process.env.APP_ENV} · cache: ${process.env.CACHE_BACKEND ?? "memory"}`,
);
if (gatewayEntry) {
  console.log(`[dev] Gateway: ${gatewayUrl.origin} (${gatewayEntry})`);
} else {
  // `pnpm dev` runs the app and Vite and nothing else, because a gateway is
  // usually someone else's process — a staging upstream, a service running in
  // another terminal. When it is not running, say so here: the alternative is a
  // site that renders with an empty menu and 500s on its data pages, which reads
  // as "the template is broken" rather than "nothing is listening on 4002".
  const reachable = await gatewayAnswers(gatewayUrl);
  console.log(
    reachable
      ? `[dev] Gateway: ${gatewayUrl.origin} (already running)`
      : `[dev] Gateway: ${gatewayUrl.origin} — nothing is listening there`,
  );
  if (!reachable) {
    console.log(
      "       Point GATEWAY_URL at your own, or run the bundled mock instead:\n" +
        "         pnpm dev:mock        # app + Vite + mock gateway\n" +
        "         pnpm mock-gw         # just the mock, in another terminal\n",
    );
  }
}

start(
  "vite",
  [
    resolve(root, "node_modules/vite/bin/vite.js"),
    "--host",
    viteUrl.hostname,
    "--port",
    viteUrl.port || "5174",
    "--strictPort",
    // Vite is an internal asset/HMR server in this architecture. Its default
    // "Local" banner looks like the application URL, so retain warnings and
    // errors but let origin-dev announce the real SSR address itself.
    "--logLevel",
    "warn",
  ],
  { SITE_URL: appUrl.origin },
);
if (gatewayEntry) {
  start("gateway", [resolve(root, gatewayEntry)], {
    MOCK_GATEWAY_PORT: gatewayUrl.port || "4002",
  });
}
start("server", [resolve(root, "node_modules/tsx/dist/cli.mjs"), "watch", "server/index.ts"], {
  NODE_ENV: "development",
  APP_ENV: "development",
  GATEWAY_URL: gatewayUrl.origin,
  SITE_URL: appUrl.origin,
  VITE_DEV_SERVER_URL: viteUrl.origin,
});

void announceReady();

async function announceReady() {
  const deadline = Date.now() + 30_000;
  while (!stopping && Date.now() < deadline) {
    const [appReady, viteReady] = await Promise.all([
      responds(new URL("/healthz", appUrl)),
      responds(viteUrl),
    ]);
    if (appReady && viteReady) {
      console.log(`\n[dev] ready — open ${appUrl.origin}`);
      console.log("[dev] client assets and HMR are connected automatically.\n");
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (!stopping) {
    console.warn(`[dev] startup is taking longer than expected; check the process logs above.`);
  }
}

async function responds(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}
