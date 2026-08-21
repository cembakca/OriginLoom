/**
 * Deployment assets for the `with-ops` create-app plugin.
 *
 * Consumed via `plugins/with-ops/files.mjs`. Opt-in because most apps do not
 * need deployment scaffolding on day one.
 */
export function renderOpsTemplates({ name, port, metricsPort, includeCapacity = false }) {
  return {
    "docker-compose.yml": dockerCompose(name, port),
    "docker-compose.redis.yml": dockerComposeRedis(),
    "k8s/deployment.yaml": deployment(name, port, metricsPort),
    "k8s/service.yaml": service(name, port),
    "k8s/operations-service.yaml": operationsService(name, metricsPort),
    "k8s/configmap.yaml": configMap(name, port, metricsPort),
    "k8s/configmap.memory.yaml": configMapMemory(name),
    "k8s/configmap.redis.yaml": configMapRedis(name),
    "k8s/secret.yaml": secret(name),
    "k8s/ingress.yaml": ingress(name, port),
    "k8s/hpa.yaml": hpa(name),
    "k8s/pdb.yaml": pdb(name),
    "k8s/network-policy.yaml": networkPolicy(name, port, metricsPort),
    "k8s/prometheus-rules.yaml": prometheusRules(name),
    "load-test/run.mjs": loadTest(port),
    "load-test/stress.mjs": stressTest(),
    "load-test/compare.mjs": compareResults(),
    "scripts/pentest-readiness.mjs": pentestReadiness(port, metricsPort),
    "OPERATIONS.md": operationsDoc(name, port, metricsPort, includeCapacity),
  };
}

const dockerCompose = (name, port) => `services:
  app:
    build:
      context: .
    ports:
      - "${port}:${port}"
    env_file:
      - .env.production
    environment:
      # Cluster hostnames and secrets, overridden for a local simulation.
      CACHE_BACKEND: memory
      # host.docker.internal reaches a gateway started on the host, e.g.
      # \`pnpm mock-gw\` in another terminal.
      GATEWAY_URL: \${GATEWAY_URL:-http://host.docker.internal:4002}
      RELEASE_ID: docker-compose
      SITE_URL: http://localhost:${port}
      CACHE_PURGE_SECRET: dev-purge-secret
      AUTH_REFRESH_COORDINATION_SECRET: dev-auth-refresh-secret
      ALLOW_INSECURE_GATEWAY: "true"
      TRUSTED_PROXY_HOPS: "1"
      TRUSTED_PROXY_CIDRS: "172.16.0.0/12"
    extra_hosts:
      - "host.docker.internal:host-gateway"
`;

const dockerComposeRedis =
  () => `# Shared L2 cache and Pub/Sub invalidation, for simulating more than one pod.
# Usage: docker compose -f docker-compose.yml -f docker-compose.redis.yml up
#    or: pnpm compose:redis

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  app:
    depends_on:
      redis:
        condition: service_healthy
    environment:
      CACHE_BACKEND: redis
      REDIS_URL: redis://redis:6379
`;

const deployment = (name, port, metricsPort) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  replicas: 2
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      # Never drop below the current capacity while rolling.
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: /metrics
        prometheus.io/port: "${metricsPort}"
    spec:
      automountServiceAccountToken: false
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: ${name}
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: ${name}
          # CI must replace this with the pushed image digest.
          image: registry.example.com/${name}@sha256:0000000000000000000000000000000000000000000000000000000000000000
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          ports:
            - name: http
              containerPort: ${port}
            - name: metrics
              containerPort: ${metricsPort}
          envFrom:
            - configMapRef:
                name: ${name}-config
            - secretRef:
                name: ${name}-secrets
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          # /healthz says the process is alive; /readyz says it can serve, which
          # is why only readiness gates traffic.
          livenessProbe:
            httpGet:
              path: /healthz
              port: ${port}
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /readyz
              port: ${port}
            initialDelaySeconds: 5
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /healthz
              port: ${port}
            failureThreshold: 30
            periodSeconds: 2
          lifecycle:
            preStop:
              exec:
                # Let the endpoint removal propagate before the process starts
                # refusing connections, so no request lands on a dying pod.
                command: ["/bin/sh", "-c", "sleep 5"]
      # Must exceed SHUTDOWN_TIMEOUT_MS plus the preStop sleep, or a drain that
      # is doing its job gets killed anyway.
      terminationGracePeriodSeconds: 30
`;

const service = (name, port) => `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  type: ClusterIP
  selector:
    app: ${name}
  ports:
    - name: http
      port: ${port}
      targetPort: ${port}
`;

const operationsService = (
  name,
  metricsPort,
) => `# Metrics and cache purge. Kept on its own service so it can be exposed to
# monitoring and operations without ever being reachable from the internet.
apiVersion: v1
kind: Service
metadata:
  name: ${name}-operations
  labels:
    app: ${name}
spec:
  type: ClusterIP
  selector:
    app: ${name}
  ports:
    - name: operations
      port: ${metricsPort}
      targetPort: metrics
`;

const configMap = (
  name,
  port,
  metricsPort,
) => `# Non-secret configuration. Every value here has a working default in
# @originloom/core; they are spelled out so a deployment is explicit about what
# it runs with rather than inheriting whatever the platform version defaults to.
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-config
data:
  NODE_ENV: production
  APP_ENV: production
  PORT: "${port}"
  METRICS_PORT: "${metricsPort}"

  GATEWAY_URL: https://gateway.example.com
  SITE_URL: https://www.example.com
  # Startup rejects this sentinel in production; inject a real release or Git SHA.
  RELEASE_ID: replace-with-release-or-git-sha

  # Time budgets. A request that outlives its budget is failed on purpose: a
  # slow page that still answers holds a connection the next visitor needs.
  GATEWAY_TIMEOUT_MS: "5000"
  GATEWAY_CONNECT_TIMEOUT_MS: "1000"
  GATEWAY_HEADERS_TIMEOUT_MS: "5000"
  GATEWAY_BODY_TIMEOUT_MS: "5000"
  GATEWAY_MAX_CONNECTIONS: "64"
  GATEWAY_PIPELINING: "1"
  GATEWAY_KEEP_ALIVE_TIMEOUT_MS: "10000"
  SSR_REQUEST_TIMEOUT_MS: "15000"
  API_REQUEST_TIMEOUT_MS: "12000"
  PROXY_REQUEST_TIMEOUT_MS: "8000"
  CACHE_FILL_TIMEOUT_MS: "12000"
  CACHE_FILL_WAIT_MS: "12500"
  CACHE_FILL_POLL_MS: "100"

  # Render admission: past the queue, requests are shed with 503 so the app
  # stays responsive instead of collapsing. Unset SSR_MAX_CONCURRENCY scales
  # with CPU (max(32, cores×4), cap 256); explicit env always wins.
  SSR_MAX_CONCURRENCY: "32"
  SSR_MAX_QUEUE: "64"
  SSR_QUEUE_WAIT_MS: "250"

  CACHE_BACKEND: memory
  CACHE_REQUIRED: "false"
  CACHE_MAX_ENTRIES: "2000"

  SWR_REVALIDATION_ATTEMPTS: "3"
  SWR_REVALIDATION_BACKOFF_MS: "250"
  SWR_DRAIN_TIMEOUT_MS: "5000"

  # Client IPs arrive through the ingress, so the hop count has to match the
  # proxy chain exactly — too many hops and any caller can claim any IP.
  TRUST_PROXY: "true"
  TRUSTED_PROXY_HOPS: "1"
  TRUSTED_PROXY_CIDRS: "10.0.0.0/8"

  CSP_ENFORCE: "true"
  PROXY_BODY_LIMIT_BYTES: "1048576"
  SHUTDOWN_TIMEOUT_MS: "10000"
  HTTP_COMPRESSION_THRESHOLD_BYTES: "1024"
  LOG_LEVEL: info
  REQUEST_LOG_SAMPLE_RATE: "0.1"

  # This app's own settings — see server/product/config.ts.
  CATALOG_PAGE_SIZE: "3"
  SUPPORT_EMAIL: destek@example.com
`;

const configMapMemory = (name) => `# Single-pod cache overlay — no Redis needed.
# kubectl apply -f k8s/configmap.yaml -f k8s/configmap.memory.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-config
data:
  CACHE_BACKEND: memory
  CACHE_REQUIRED: "false"
`;

const configMapRedis = (
  name,
) => `# Shared L2 cache and Pub/Sub invalidation — the choice for more than one pod.
# REDIS_URL comes from the Secret; this overlay only settles cache behaviour.
# kubectl apply -f k8s/configmap.yaml -f k8s/configmap.redis.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-config
data:
  CACHE_BACKEND: redis
  CACHE_REQUIRED: "true"
`;

const secret = (name) => `apiVersion: v1
kind: Secret
metadata:
  name: ${name}-secrets
type: Opaque
stringData:
  # Replace through your secret manager; do not commit real credentials.
  # Required only when CACHE_BACKEND=redis.
  REDIS_URL: rediss://managed-redis.example.internal:6379
  # Startup rejects replace-with-* sentinels in production.
  CACHE_PURGE_SECRET: replace-with-a-long-random-secret
  # Coordinates token refresh across pods so a burst of expired sessions turns
  # into one upstream refresh rather than one per request.
  AUTH_REFRESH_COORDINATION_SECRET: replace-with-a-dedicated-long-random-secret
  # Set during a rotation so tokens signed with the old secret still verify.
  AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET: ""
`;

const ingress = (name, port) => `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name}
  annotations:
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/limit-connections: "50"
    nginx.ingress.kubernetes.io/limit-rps: "100"
    # Match PROXY_BODY_LIMIT_BYTES: rejecting at the edge is cheaper.
    nginx.ingress.kubernetes.io/proxy-body-size: "1m"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - www.example.com
      secretName: ${name}-tls
  rules:
    - host: www.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${name}
                port:
                  number: ${port}
`;

const hpa = (name) => `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${name}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${name}
  minReplicas: 2
  maxReplicas: 10
  behavior:
    scaleDown:
      # Traffic dips are common; scaling down on one is how you end up scaling
      # back up a minute later with a cold cache.
      stabilizationWindowSeconds: 300
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`;

const pdb = (name) => `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${name}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: ${name}
`;

const networkPolicy = (
  name,
  port,
  metricsPort,
) => `# The site port is reachable from the ingress only, and the operations port
# from monitoring only. Without this, any pod in the cluster could purge the
# cache or read the metrics.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${name}-ingress-boundary
spec:
  podSelector:
    matchLabels:
      app: ${name}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: ${port}
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: operations
      ports:
        - protocol: TCP
          port: ${metricsPort}
`;

const prometheusRules = (
  name,
) => `# Alerts on metrics @originloom/core exports, so they work for any app on the
# platform. Thresholds are starting points — tune them against your own traffic
# before trusting a page at 3am.
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: ${name}-platform
  labels:
    app: ${name}
spec:
  groups:
    - name: ${name}.cache
      rules:
        - alert: SsrCacheCardinalityOverflow
          expr: sum by (route) (increase(ssr_cache_cardinality_overflow_total[5m])) > 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Cache key cardinality exceeded its bounded observation window"
            description: "Route {{ $labels.route }} produces unbounded or unexpectedly diverse cache keys — usually a user-controlled value leaking into the key."

        - alert: SsrCacheEntryBodyTooLarge
          expr: histogram_quantile(0.95, sum by (route, le) (rate(ssr_cache_entry_body_bytes_bucket[10m]))) > 524288
          for: 15m
          labels:
            severity: warning
          annotations:
            summary: "Cached HTML p95 is over 512 KiB"
            description: "Route {{ $labels.route }} is producing unusually large cached responses."

        - alert: SsrGatewayInvalidPayload
          expr: sum by (contract, reason) (increase(ssr_gateway_invalid_payload_total[10m])) > 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Gateway returned a payload that failed its contract"
            description: "Contract {{ $labels.contract }} is failing with {{ $labels.reason }} — an upstream change or a budget that no longer fits."

        - alert: SsrColdCacheFillTimeout
          expr: sum by (route) (increase(ssr_cache_fill_timeout_total[10m])) > 0
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "Cold cache fill timed out"
            description: "Route {{ $labels.route }} could not render inside its fill budget."

    - name: ${name}.slo
      rules:
        - alert: SsrHigh5xxRate
          expr: sum(rate(ssr_http_requests_total{status=~"5.."}[5m])) / sum(rate(ssr_http_requests_total[5m])) > 0.02
          for: 10m
          labels:
            severity: critical
          annotations:
            summary: "More than 2% of responses are 5xx"

        - alert: SsrLatencyP95TooHigh
          expr: histogram_quantile(0.95, sum by (le) (rate(ssr_http_request_duration_seconds_bucket[5m]))) > 1
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "Request latency p95 is above one second"

        - alert: SsrQueueDepthHigh
          expr: ssr_render_queue_depth > 32
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Renders are queuing"
            description: "Sustained queue depth means the pod is admitting more work than it can render — scale out or raise SSR_MAX_CONCURRENCY if CPU allows."

        - alert: SsrRenderRejectionsHigh
          expr: sum(increase(ssr_render_rejected_total[5m])) > 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Renders are being shed"
            description: "The queue is full and requests are answered with 503 — the app is protecting itself, but visitors are seeing it."

        - alert: SsrRedisOperationsFailed
          expr: sum(increase(ssr_redis_operation_failures_total[5m])) > 0
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Redis operations are failing"
            description: "The shared cache is degraded; the app keeps serving from L1 but pods no longer agree."
`;

const loadTest = (port) => `#!/usr/bin/env node
/**
 * A small closed-loop load generator: N workers, each sending the next request
 * as soon as the previous one answers.
 *
 * It measures the app, not the network, so run it against a production build
 * (\`pnpm build && pnpm start\`) rather than dev — dev compiles on demand and
 * every number would be about Vite.
 *
 * Usage:
 *   node load-test/run.mjs
 *   node load-test/run.mjs --workers 32 --seconds 30 --path /catalog
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (flagName, fallback) => {
  const index = args.indexOf(flagName);
  return index === -1 ? fallback : args[index + 1];
};

const base = flag("--base", "http://127.0.0.1:${port}");
const path = flag("--path", "/");
const workers = Number(flag("--workers", "16"));
const seconds = Number(flag("--seconds", "15"));
const output = flag("--output", "");

const url = new URL(path, base).toString();
const latencies = [];
const statuses = new Map();
let cacheHits = 0;
const deadline = Date.now() + seconds * 1000;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(url, { headers: { accept: "text/html" } });
      await response.arrayBuffer(); // Read the body: an unread response is not a served one.
      latencies.push(performance.now() - started);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      if (response.headers.get("x-cache") === "HIT") cacheHits++;
    } catch (error) {
      statuses.set(String(error), (statuses.get(String(error)) ?? 0) + 1);
    }
  }
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

console.log(\`\${workers} workers → \${url} for \${seconds}s\`);
await Promise.all(Array.from({ length: workers }, worker));

const sorted = [...latencies].sort((a, b) => a - b);

// Every request failed — report that rather than dividing by nothing.
if (sorted.length === 0) {
  console.error(\`no successful requests: \${[...statuses].map(([s, n]) => \`\${s}=\${n}\`).join(" ")}\`);
  console.error(\`is the app running on \${base}? build first: pnpm build && pnpm start\`);
  process.exit(1);
}

const elapsed = seconds;
const result = {
  url,
  workers,
  seconds,
  requests: latencies.length,
  requestsPerSecond: latencies.length / elapsed,
  latency: {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  },
  cacheHitRate: cacheHits / latencies.length,
  statuses: Object.fromEntries(statuses),
};
console.log(\`
  requests   \${latencies.length} (\${(latencies.length / elapsed).toFixed(1)}/s)
  latency    p50 \${percentile(sorted, 0.5).toFixed(1)}ms · p95 \${percentile(sorted, 0.95).toFixed(1)}ms · p99 \${percentile(sorted, 0.99).toFixed(1)}ms
  cache      \${((cacheHits / latencies.length) * 100).toFixed(1)}% HIT
  statuses   \${[...statuses].map(([status, count]) => \`\${status}=\${count}\`).join(" ")}
\`);

if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\\n", "utf8");
  console.log(\`result → \${output}\`);
}

// A run with any non-2xx result is not a baseline worth recording.
if ([...statuses.keys()].some((status) => typeof status !== "number" || status >= 300)) {
  process.exitCode = 1;
}
`;

const stressTest = () => `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const forwarded = process.argv.slice(2);
if (!forwarded.includes("--workers")) forwarded.push("--workers", "64");
if (!forwarded.includes("--seconds")) forwarded.push("--seconds", "60");
const result = spawnSync(process.execPath, [join(here, "run.mjs"), ...forwarded], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
`;

const compareResults = () => `#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [leftPath, rightPath] = process.argv.slice(2);
if (!leftPath || !rightPath) {
  console.error("usage: node load-test/compare.mjs memory.json redis.json");
  process.exit(1);
}
const [left, right] = await Promise.all(
  [leftPath, rightPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);
const change = (before, after) => (((after - before) / before) * 100).toFixed(1) + "%";
console.table([
  { metric: "requests/s", left: left.requestsPerSecond, right: right.requestsPerSecond, change: change(left.requestsPerSecond, right.requestsPerSecond) },
  { metric: "p95 ms", left: left.latency.p95, right: right.latency.p95, change: change(left.latency.p95, right.latency.p95) },
  { metric: "cache HIT", left: left.cacheHitRate, right: right.cacheHitRate, change: change(left.cacheHitRate, right.cacheHitRate) },
]);
`;

const pentestReadiness = (port, metricsPort) => `#!/usr/bin/env node
const base = (process.env.BASE_URL ?? "http://127.0.0.1:${port}").replace(/\\/$/, "");
const ops = (process.env.OPS_URL ?? "http://127.0.0.1:${metricsPort}").replace(/\\/$/, "");
const failures = [];

async function check(label, run) {
  try {
    const ok = await run();
    console.log(\`\${ok ? "✓" : "✗"} \${label}\`);
    if (!ok) failures.push(label);
  } catch (error) {
    console.log(\`✗ \${label}: \${error instanceof Error ? error.message : String(error)}\`);
    failures.push(label);
  }
}

await check("health endpoint", async () => (await fetch(base + "/healthz")).ok);
await check("operations metrics are not public", async () => (await fetch(base + "/metrics")).status === 404);
await check("security headers", async () => {
  const response = await fetch(base + "/", { headers: { accept: "text/html" } });
  return Boolean(response.headers.get("content-security-policy") || response.headers.get("content-security-policy-report-only")) &&
    response.headers.get("x-content-type-options") === "nosniff";
});
await check("cross-site SSE rejected", async () =>
  (await fetch(base + "/api/ticks", { headers: { accept: "text/event-stream", "sec-fetch-site": "cross-site" } })).status === 403,
);
await check("operations listener", async () => (await fetch(ops + "/metrics")).ok);

console.log(\`\\n\${failures.length ? failures.length + " failed" : "all checks passed"}\`);
if (failures.length) process.exitCode = 1;
`;

const operationsDoc = (name, port, metricsPort, includeCapacity) => `# ${name} — çalıştırma

\`--with-ops\` ile üretilen dosyalar. Hepsi **başlangıç noktası**: imaj digest'i,
host adları ve secret'lar bilinçli olarak yer tutucu.

## Lokal

\`\`\`bash
pnpm compose:up          # docker-compose.yml — tek pod, L1 cache
pnpm compose:redis       # + docker-compose.redis.yml — Redis L2 + Pub/Sub
pnpm compose:clean       # container'ları kaldır
pnpm dev:redis           # dev sunucusu, yanında lokal Redis ile
\`\`\`

Compose \`.env.production\` okur ve üstüne lokal değerleri yazar. Gateway'i kendin
başlatırsın: \`pnpm mock-gw\` yeterli, container ona \`host.docker.internal\`
üzerinden ulaşır.

## Yük testi

\`\`\`bash
pnpm build && pnpm start          # ölçüm production build'e karşı yapılır
node load-test/run.mjs --workers 32 --seconds 30 --path /catalog
node load-test/run.mjs --output load-test/results/memory.json
pnpm stress -- --path /catalog
pnpm loadtest:compare -- load-test/results/memory.json load-test/results/redis.json
pnpm pentest:readiness
\`\`\`

${
  includeCapacity
    ? `### Tek komutluk kapsamlı kapasite testi

\`pnpm capacity\` production build'i alır; çakışmayan geçici portlarda uygulama ve mock gateway'i
başlatır; bütün React örnek route'larını 10, 25, 50, 100, 200 ve 400 bağlantıda üçer kez ölçer.
Her route için 30 saniye warm-up yapar; her kademeyi 60 saniye ve üç tekrar ölçer. Cold-burst, warm
data-cache, stale single-flight ve origin data-cache olmayan public API deneylerini ayrıca çalıştırır.
Varsayılan full profil yaklaşık dört saat sürer.

\`load-test/reports/latest.md\` okunabilir özet; yanındaki \`latest.json\` bütün ham tekrarları,
status dağılımlarını, app/generator CPU, RSS/heap, event-loop, cache ve gateway delta'larını içerir.
Timestamp'li kopyalar aynı klasörde tutulur. Bu klasör gitignore'dadır.

\`\`\`bash
pnpm capacity                 # kapsamlı profil
pnpm capacity:quick           # kısa wiring kontrolü
pnpm capacity -- --only catalog,data-cache --connections 25,50,100
pnpm capacity -- --gateway-delay-ms 20
\`\`\`

Runner ve uygulama aynı makinede CPU paylaşır. Rapor bunu açıkça işaretler ve yalnız uygulama
process'ine ait kaynak metriklerini operations portundan ayrıca toplar. Sonuçları production kapasite
taahhüdü değil; aynı makinede regression, cache koruması ve saturation knee analizi olarak kullanın.
`
    : ""
}

Dev sunucusuna karşı ölçme: dev talep üzerine derler, çıkan sayı Vite'ı ölçer.
Önce bir kez \`memory\` backend ile, sonra \`pnpm compose:redis\` ile ölçüp
karşılaştırmak L2'nin ne kazandırdığını gösterir.

## Kubernetes

\`\`\`bash
kubectl apply -f k8s/configmap.yaml -f k8s/configmap.memory.yaml
kubectl apply -f k8s/secret.yaml        # önce gerçek secret'ları koy
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/operations-service.yaml
kubectl apply -f k8s/pdb.yaml -f k8s/hpa.yaml -f k8s/network-policy.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/prometheus-rules.yaml
\`\`\`

Uygulamadan önce mutlaka değiştirilmesi gerekenler:

| Dosya | Alan |
| --- | --- |
| \`deployment.yaml\` | \`image\` — CI'ın pushladığı digest |
| \`configmap.yaml\` | \`GATEWAY_URL\`, \`SITE_URL\`, \`RELEASE_ID\` |
| \`secret.yaml\` | tüm değerler — secret yöneticinden |
| \`ingress.yaml\` | \`host\` ve TLS secret adı |

Birden fazla pod çalıştıracaksan \`configmap.memory.yaml\` yerine
\`configmap.redis.yaml\` uygula: L1 cache pod başına ayrıdır, purge bir pod'u
temizleyip diğerini bırakır.

## İki port, iki sınır

Site \`${port}\`, operasyon ucu \`${metricsPort}\`. \`/metrics\` ve cache purge
operasyon portunda durur ve \`network-policy.yaml\` onu yalnızca monitoring ve
operations namespace'lerine açar. Secret ile korunsa bile internete açık bir
purge ucu DoS kaldıracıdır.

## \`RELEASE_ID\`

Paylaşılan Redis cache'ini isim alanına ayırır. Her dağıtımda değişmeli,
yoksa yeni sürüm eskinin HTML'ini servis eder; ve her uygulama kendi değerini
kullanmalı, yoksa iki uygulama birbirinin cache'ini okur.
`;
