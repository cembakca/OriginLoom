import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} ${args.join(" ")} stopped with ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

/**
 * Starts (or reuses) the `redis` service defined in docker-compose.redis.yml and waits for its
 * healthcheck. That service only exists once this overlay file is included — callers must not call
 * plain `docker compose up redis` without it, or Compose falls back to the base docker-compose.yml
 * where no `redis` service is defined.
 */
export async function ensureLocalRedis() {
  const code = await run("docker", [
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.redis.yml",
    "up",
    "-d",
    "--wait",
    "redis",
  ]);
  if (code !== 0) throw new Error("Redis container could not be started");
}
