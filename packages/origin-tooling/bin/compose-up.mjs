import { spawn } from "node:child_process";

import { COMPOSE_BASE, COMPOSE_REDIS, downDevStack } from "./docker-compose.mjs";

const useRedis = process.argv.includes("--redis");
const composeFiles = useRedis ? COMPOSE_REDIS : COMPOSE_BASE;

let stopping = false;

async function cleanup() {
  if (stopping) return;
  stopping = true;
  console.log("\nRemoving compose containers…");
  try {
    await downDevStack({ redis: useRedis, removeOrphans: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = process.exitCode ?? 1;
  }
}

const child = spawn("docker", ["compose", ...composeFiles, "up", "--build"], {
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  void cleanup().finally(() => process.exit(1));
});

child.once("exit", (code, signal) => {
  void cleanup().finally(() => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
