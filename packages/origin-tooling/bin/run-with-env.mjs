import { spawn } from "node:child_process";

import { loadEnv } from "./load-env.mjs";

const [appEnv, ...command] = process.argv.slice(2);
if (!appEnv || command.length === 0) {
  console.error("Usage: origin-run-with-env <development|staging|production> <command...>");
  process.exit(1);
}

loadEnv(appEnv);

const [cmd, ...args] = command;
const child = spawn(cmd, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) process.exit(stopping ? 0 : 1);
  process.exit(code ?? 1);
});
