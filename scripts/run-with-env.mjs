import { spawn } from "node:child_process";

import { loadEnv } from "./load-env.mjs";

const [appEnv, ...command] = process.argv.slice(2);
if (!appEnv || command.length === 0) {
  console.error(
    "Usage: node scripts/run-with-env.mjs <development|staging|production> <command...>",
  );
  process.exit(1);
}

loadEnv(appEnv);

const [cmd, ...args] = command;
const child = spawn(cmd, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
