import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.env.ORIGIN_APP_ROOT ?? process.cwd());
const loadTestDir = resolve(root, "load-test");

/** Base stack: mock-gw + app (L1-only). */
export const COMPOSE_BASE = ["-f", "docker-compose.yml"];

/** Redis overlay — `redis` servisi yalnızca bu dosyayla tanımlı. */
export const COMPOSE_REDIS = ["-f", "docker-compose.yml", "-f", "docker-compose.redis.yml"];

export function runDocker(args, { cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: "inherit", cwd });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`docker ${args.join(" ")} stopped with ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export async function ensureLocalRedis() {
  const code = await runDocker(["compose", ...COMPOSE_REDIS, "up", "-d", "--wait", "redis"]);
  if (code !== 0) throw new Error("Redis container could not be started");
}

/** Stops and removes the local Redis service container (overlay compose project). */
export async function removeLocalRedis() {
  await runDocker(["compose", ...COMPOSE_REDIS, "rm", "-sf", "redis"]);
}

/**
 * @param {{ redis?: boolean, volumes?: boolean, removeOrphans?: boolean }} [options]
 * redis=true → overlay dosyalarıyla down (app + mock-gw + redis)
 */
export async function downDevStack(options = {}) {
  const { redis = false, volumes = false, removeOrphans = true } = options;
  const args = ["compose", ...(redis ? COMPOSE_REDIS : COMPOSE_BASE), "down"];
  if (removeOrphans) args.push("--remove-orphans");
  if (volumes) args.push("--volumes");
  await runDocker(args);
}

/** Load-test compose project (`origin-loom-loadtest`). */
export async function downLoadTestStack({ volumes = false } = {}) {
  const files = [
    resolve(loadTestDir, "compose.yml"),
    resolve(loadTestDir, "compose.memory.yml"),
    resolve(loadTestDir, "compose.redis.yml"),
  ];
  const args = [
    "compose",
    ...files.flatMap((file) => ["-f", file]),
    "--profile",
    "redis",
    "down",
    "--remove-orphans",
  ];
  if (volumes) args.push("--volumes");
  await runDocker(args, { cwd: loadTestDir });
}
