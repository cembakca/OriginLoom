#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import inspector from "node:inspector";
import { resolve } from "node:path";
import { promisify } from "node:util";

const [directory, cpuName, heapName] = process.argv.slice(2);
if (!directory || !cpuName || !heapName) throw new Error("profile output arguments are required");
const session = new inspector.Session();
session.connect();
const post = promisify(session.post.bind(session));
let active = false;
let stopping = false;

process.on("SIGUSR2", () => {
  void startProfilers();
});
process.on("SIGUSR1", () => {
  void stopProfilers();
});

await import(resolve("dist/server/index.js"));

async function startProfilers() {
  if (active || stopping) return;
  await post("Profiler.enable");
  await post("HeapProfiler.startSampling", { samplingInterval: 32_768 });
  await post("Profiler.start");
  active = true;
}

async function stopProfilers() {
  if (stopping) return;
  stopping = true;
  try {
    if (active) {
      const [{ profile: cpu }, { profile: heap }] = await Promise.all([
        post("Profiler.stop"),
        post("HeapProfiler.stopSampling"),
      ]);
      await Promise.all([
        writeFile(resolve(directory, cpuName), `${JSON.stringify(cpu)}\n`),
        writeFile(resolve(directory, heapName), `${JSON.stringify(heap)}\n`),
      ]);
    }
  } finally {
    session.disconnect();
    process.exit(active ? 0 : 1);
  }
}
