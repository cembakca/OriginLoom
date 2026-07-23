import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const loadTestDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(loadTestDir, "..");

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/**
 * @param {"memory" | "redis"} profile
 * @param {{ appPort?: string, metricsPort?: string, skipBuild?: boolean }} [options]
 */
export async function startLoadTestStack(profile, options = {}) {
  const appPort = options.appPort ?? process.env.LOADTEST_APP_PORT ?? "31005";
  const metricsPort = options.metricsPort ?? process.env.LOADTEST_METRICS_PORT ?? "31090";
  const composeFiles = [
    path.join(loadTestDir, "compose.yml"),
    path.join(loadTestDir, profile === "redis" ? "compose.redis.yml" : "compose.memory.yml"),
  ];
  const composeArgs = ["compose", ...composeFiles.flatMap((file) => ["-f", file])];
  if (profile === "redis") composeArgs.push("--profile", "redis");

  if (!options.skipBuild) {
    await runCommand("docker", ["build", "--tag", "origin-loom-loadtest:local", rootDir], { cwd: rootDir });
  }

  await runCommand("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
    cwd: loadTestDir,
  });
  await runCommand(
    "docker",
    [...composeArgs, "up", "--detach", "--build", "--force-recreate", "--remove-orphans"],
    {
      cwd: loadTestDir,
      env: { LOADTEST_APP_PORT: appPort, LOADTEST_METRICS_PORT: metricsPort },
    },
  );

  return { composeArgs, appPort, metricsPort, appUrl: `http://127.0.0.1:${appPort}`, metricsUrl: `http://127.0.0.1:${metricsPort}` };
}

/**
 * @param {string[]} composeArgs
 * @param {boolean} keepStack
 */
export async function stopLoadTestStack(composeArgs, keepStack) {
  if (keepStack) return;
  await runCommand("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
    cwd: loadTestDir,
  });
}
