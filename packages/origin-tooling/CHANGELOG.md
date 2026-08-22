# @originloom/tooling

## 0.7.24

### Patch Changes

- Fix a long-standing measurement error in the generated capacity/performance suite. autocannon
  reports the `hdr-histogram-percentiles-obj` set, which goes 90 -> 97.5 and contains **no p95**:
  `result.latency.p95` was always `undefined` and fell through to `p97_5`, so every number reported
  and gated as "p95" was really p97.5. The metric is now captured and reported under its real name
  (`latencyP97_5Median`), and the `0.7.24-warm-path-performance` migration renames
  `regression.latencyP95IncreasePercent` to `latencyP97_5IncreasePercent` in an existing app's
  `performance-policy.json`. The threshold value is preserved — this corrects what the gate is
  called, never what it enforces.

## 0.7.19

### Patch Changes

- Coordinate development full reloads with the ready SSR process generation, migrate generated Vite
  path allowlists, and prevent no-op icon codegen from causing watcher restart storms.

## 0.7.18

### Patch Changes

- Improve client telemetry and local development reliability: accept market-stream reports, expose
  PII-free support references for fatal island failures, stabilize pageRequestId in structured logs,
  keep the global SSR fallback active when a route boundary fails, automate 0.7.17 source
  migrations, and rebuild media assets while the dev server is running.
