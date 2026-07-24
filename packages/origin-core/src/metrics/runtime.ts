import { monitorEventLoopDelay } from "node:perf_hooks";

import { counter, escapeLabel, gauge } from "./primitives.js";

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

let hasSnapshotted = false;
let lastEventLoopP50 = 0;
let lastEventLoopP95 = 0;
let lastEventLoopP99 = 0;

const eventLoopInterval = setInterval(() => {
  const scale = 1e6;
  lastEventLoopP50 = eventLoopDelay.percentile(50) / scale / 1_000;
  lastEventLoopP95 = eventLoopDelay.percentile(95) / scale / 1_000;
  lastEventLoopP99 = eventLoopDelay.percentile(99) / scale / 1_000;
  eventLoopDelay.reset();
  hasSnapshotted = true;
}, 10_000);
eventLoopInterval.unref();

export function runtimeMetricLines(): string[] {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const release = escapeLabel(process.env.RELEASE_ID ?? "development");
  const service = escapeLabel(process.env.OTEL_SERVICE_NAME ?? "origin-loom");

  return [
    ...gauge("ssr_event_loop_lag_p50_seconds", "Event loop delay p50", eventLoopP50()),
    ...gauge("ssr_event_loop_lag_p95_seconds", "Event loop delay p95", eventLoopP95()),
    ...gauge("ssr_event_loop_lag_p99_seconds", "Event loop delay p99", eventLoopP99()),
    ...gauge("process_resident_memory_bytes", "Resident memory size", memory.rss),
    ...gauge("process_heap_used_bytes", "Process heap used", memory.heapUsed),
    ...gauge("process_uptime_seconds", "Process uptime", process.uptime()),
    ...counter("process_cpu_user_seconds_total", "Total user CPU time", cpu.user / 1e6),
    ...counter("process_cpu_system_seconds_total", "Total system CPU time", cpu.system / 1e6),
    ...gauge(
      "ssr_release_info",
      "Build and service identity",
      1,
      `service="${service}",release="${release}"`,
    ),
  ];
}

function eventLoopP50(): number {
  return hasSnapshotted ? lastEventLoopP50 : eventLoopDelay.percentile(50) / 1e9;
}

function eventLoopP95(): number {
  return hasSnapshotted ? lastEventLoopP95 : eventLoopDelay.percentile(95) / 1e9;
}

function eventLoopP99(): number {
  return hasSnapshotted ? lastEventLoopP99 : eventLoopDelay.percentile(99) / 1e9;
}
