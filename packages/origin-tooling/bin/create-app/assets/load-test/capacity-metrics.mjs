export function parsePrometheus(text) {
  const samples = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = /^(\w+)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(
      line.trim(),
    );
    if (!match) continue;
    samples.push({
      name: match[1],
      labels: parseLabels(match[2] ?? ""),
      value: Number(match[3]),
    });
  }
  return samples;
}

export function sumMetric(samples, name, labels = {}) {
  return samples
    .filter(
      (sample) =>
        sample.name === name &&
        Object.entries(labels).every(([key, value]) => sample.labels[key] === value),
    )
    .reduce((total, sample) => total + sample.value, 0);
}

export function metricValue(samples, name) {
  return samples.find((sample) => sample.name === name)?.value;
}

export function metricDelta(before, after, name, labels = {}) {
  return Math.max(0, sumMetric(after, name, labels) - sumMetric(before, name, labels));
}

export async function fetchMetrics(opsBase) {
  const response = await fetch(`${opsBase}/metrics`, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`metrics endpoint returned HTTP ${response.status}`);
  return parsePrometheus(await response.text());
}

export function createResourceSummary() {
  return {
    rssPeakBytes: 0,
    heapPeakBytes: 0,
    eventLoopP95PeakMs: 0,
    eventLoopP99PeakMs: 0,
  };
}

export function observeResources(summary, samples) {
  summary.rssPeakBytes = Math.max(
    summary.rssPeakBytes,
    metricValue(samples, "process_resident_memory_bytes") ?? 0,
  );
  summary.heapPeakBytes = Math.max(
    summary.heapPeakBytes,
    metricValue(samples, "process_heap_used_bytes") ?? 0,
  );
  summary.eventLoopP95PeakMs = Math.max(
    summary.eventLoopP95PeakMs,
    (metricValue(samples, "ssr_event_loop_lag_p95_seconds") ?? 0) * 1_000,
  );
  summary.eventLoopP99PeakMs = Math.max(
    summary.eventLoopP99PeakMs,
    (metricValue(samples, "ssr_event_loop_lag_p99_seconds") ?? 0) * 1_000,
  );
}

function parseLabels(value) {
  const labels = {};
  for (const match of value.matchAll(/(\w+)="((?:\\.|[^"])*)"/g)) {
    labels[match[1]] = match[2].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return labels;
}
