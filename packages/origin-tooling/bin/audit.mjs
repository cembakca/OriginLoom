#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import {
  parsePmFlag,
  readPackageJson,
  readProjectMetadata,
  resolvePackageManager,
} from "./lib/package-manager.mjs";

const cwd = process.cwd();
const argv = process.argv.slice(2);
const override = parsePmFlag(argv);
const packageJson = readPackageJson(cwd);
const metadata = readProjectMetadata(cwd);
const pm = resolvePackageManager(cwd, { override, metadata, packageJson });

const commandLine =
  pm === "pnpm"
    ? ["pnpm", "audit", "--prod", "--audit-level=high"]
    : pm === "npm"
      ? ["npm", "audit", "--omit=dev", "--audit-level=high"]
      : ["yarn", "npm", "audit", "--environment", "production", "--severity", "high"];

const result = spawnSync(commandLine[0], commandLine.slice(1), {
  cwd,
  stdio: "inherit",
  shell: process.platform === "win32" && pm === "yarn",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
