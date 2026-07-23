import { spawn } from "node:child_process";

import { loadEnv } from "./load-env.mjs";

loadEnv("production");

process.env.CACHE_BACKEND = "memory";
delete process.env.REDIS_URL;
process.env.CACHE_REQUIRED = "false";

const child = spawn(
  "node",
  ["--enable-source-maps", "dist/server/index.js"],
  {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
