import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function aggregateRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${run.route.id}\0${run.connections}`;
    const group = groups.get(key) ?? { route: run.route, connections: run.connections, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => summarizeGroup(group))
    .sort(
      (left, right) =>
        left.route.id.localeCompare(right.route.id) || left.connections - right.connections,
    );
}

export function analyzeCapacity(aggregates) {
  const routes = new Map();
  for (const aggregate of aggregates) {
    const values = routes.get(aggregate.route.id) ?? [];
    values.push(aggregate);
    routes.set(aggregate.route.id, values);
  }

  return [...routes.values()].map((stages) => {
    stages.sort((left, right) => left.connections - right.connections);
    const baseline = stages[0];
    let recommended = baseline;
    let knee;
    for (let index = 0; index < stages.length; index++) {
      const current = stages[index];
      const previous = stages[Math.max(0, index - 1)];
      const rpsGain = previous.rpsMedian
        ? ((current.rpsMedian - previous.rpsMedian) / previous.rpsMedian) * 100
        : 0;
      const latencyGrowth = previous.latencyP99Median
        ? ((current.latencyP99Median - previous.latencyP99Median) / previous.latencyP99Median) * 100
        : 0;
      const unhealthy =
        !current.valid ||
        current.resource.eventLoopP99PeakMs > 100 ||
        (index > 0 && rpsGain < 10 && latencyGrowth > 25);
      if (unhealthy) {
        knee = current;
        recommended = previous;
        break;
      }
      recommended = current;
    }
    return { route: baseline.route, baseline, recommended, knee, stages };
  });
}

export async function writeCapacityReports(report, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const stamp = report.startedAt.replaceAll(":", "-").replaceAll(".", "-");
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  const paths = {
    json: join(outputDirectory, `capacity-${stamp}.json`),
    markdown: join(outputDirectory, `capacity-${stamp}.md`),
    latestJson: join(outputDirectory, "latest.json"),
    latestMarkdown: join(outputDirectory, "latest.md"),
  };
  await Promise.all([
    writeFile(paths.json, json, "utf8"),
    writeFile(paths.markdown, markdown, "utf8"),
    writeFile(paths.latestJson, json, "utf8"),
    writeFile(paths.latestMarkdown, markdown, "utf8"),
  ]);
  return paths;
}

function summarizeGroup(group) {
  const rps = group.runs.map((run) => run.requestsPerSecond);
  const valid = group.runs.every((run) => run.valid);
  return {
    route: group.route,
    connections: group.connections,
    repeatCount: group.runs.length,
    valid,
    requestsTotal: sum(group.runs.map((run) => run.requests)),
    rpsMedian: median(rps),
    rpsMin: Math.min(...rps),
    rpsMax: Math.max(...rps),
    rpsCvPercent: coefficientOfVariation(rps),
    latencyAverageMedian: median(group.runs.map((run) => run.latency.average)),
    latencyP50Median: median(group.runs.map((run) => run.latency.p50)),
    latencyP95Median: median(group.runs.map((run) => run.latency.p95)),
    latencyP99Median: median(group.runs.map((run) => run.latency.p99)),
    latencyMax: Math.max(...group.runs.map((run) => run.latency.max)),
    errors: sum(group.runs.map((run) => run.errors)),
    timeouts: sum(group.runs.map((run) => run.timeouts)),
    unexpectedStatuses: mergeCounts(group.runs.map((run) => run.unexpectedStatuses)),
    gatewayRequests: sum(group.runs.map((run) => run.metrics.gatewayRequests)),
    cache: mergeCounts(group.runs.map((run) => run.cacheStates)),
    appCpuPercentMedian: median(group.runs.map((run) => run.metrics.appCpuPercent)),
    generatorCpuPercentMedian: median(group.runs.map((run) => run.metrics.generatorCpuPercent)),
    documentRenderP95Median: median(
      group.runs.map((run) => run.metrics.documentRender?.quantile ?? 0),
    ),
    gatewayJsonParseP95Median: median(
      group.runs.map((run) => run.metrics.gatewayJsonParse?.quantile ?? 0),
    ),
    resource: {
      rssPeakBytes: Math.max(...group.runs.map((run) => run.resource.rssPeakBytes)),
      heapPeakBytes: Math.max(...group.runs.map((run) => run.resource.heapPeakBytes)),
      eventLoopP95PeakMs: Math.max(...group.runs.map((run) => run.resource.eventLoopP95PeakMs)),
      eventLoopP99PeakMs: Math.max(...group.runs.map((run) => run.resource.eventLoopP99PeakMs)),
    },
  };
}

function renderMarkdown(report) {
  const cvLimit = report.performancePolicy?.reliability?.maxCoefficientOfVariationPercent ?? 10;
  const generatorCpuLimit = report.performancePolicy?.reliability?.generatorCpuLimitPercent ?? 90;
  const failures = report.runs.filter((run) => !run.valid);
  const unstable = report.aggregates.filter((group) => group.rpsCvPercent > cvLimit);
  const generatorLimited = report.aggregates.filter(
    (group) => group.generatorCpuPercentMedian >= generatorCpuLimit,
  );
  const cacheFailures = report.cacheExperiments.filter((experiment) => !experiment.passed);
  const correctnessFailures = (report.cacheAcceptance?.topologies ?? []).flatMap(({ scenarios }) =>
    scenarios.filter(({ passed }) => !passed),
  );
  const payloadFailures = (report.payloadBudgetResults ?? []).filter(({ passed }) => !passed);
  const runtimeBudgetFailures = (report.runtimeBudgetResults ?? []).filter(({ passed }) => !passed);
  const baselineFailures = (report.baselineComparison?.results ?? []).filter(
    ({ passed }) => !passed,
  );
  const lines = [
    "# OriginLoom kapasite raporu",
    "",
    `Oluşturulma: ${report.finishedAt}`,
    "",
    "> Bu test load generator, uygulama ve mock gateway aynı makinedeyken çalıştı. Sonuçlar aynı",
    "> makinedeki sürümleri karşılaştırmak ve saturation knee bulmak için değerlidir; production",
    "> kapasitesi veya yatay ölçek hesabı olarak kullanılmamalıdır.",
    "",
    "## Sonuç",
    "",
    `- Profil: **${report.config.profile}**`,
    `- Cache topology: **${report.environment.cacheTopology ?? "memory"}**`,
    `- Compression profili: **${report.environment.compressionProfile ?? "identity"}**`,
    `- Süre: **${formatDuration(report.durationSeconds)}**`,
    `- Toplam istek: **${integer(sum(report.runs.map((run) => run.requests)))}**`,
    `- Geçersiz ölçüm: **${failures.length}**`,
    `- Değişkenliği yüksek kademe (CV > %${number(cvLimit)}): **${unstable.length}**`,
    `- Olası load-generator sınırı (CPU >= %${number(generatorCpuLimit)}): **${generatorLimited.length}**`,
    `- Cache deneyi başarısız: **${cacheFailures.length}**`,
    `- Cache doğruluk senaryosu başarısız: **${correctnessFailures.length}**`,
    `- Payload bütçesi başarısız: **${payloadFailures.length}**`,
    `- Serialization bütçesi başarısız: **${runtimeBudgetFailures.length}**`,
    `- Baseline regresyonu: **${baselineFailures.length}**`,
    `- Genel durum: **${failures.length || unstable.length || generatorLimited.length || cacheFailures.length || correctnessFailures.length || payloadFailures.length || runtimeBudgetFailures.length || baselineFailures.length ? "İNCELE" : "GEÇTİ"}**`,
    "",
    "## Önerilen eşzamanlılık ve knee",
    "",
    "| Route | Kategori | Önerilen bağlantı | Median RPS | p99 | Knee |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...report.analysis.map(
      ({ route, recommended, knee }) =>
        `| ${escapeCell(route.title)} | ${route.category} | ${recommended.connections} | ${number(recommended.rpsMedian)} | ${number(recommended.latencyP99Median)} ms | ${knee ? `${knee.connections} bağlantı` : "ölçülmedi"} |`,
    ),
    "",
    "Knee; hata/timeout, 100 ms üzeri event-loop p99 veya RPS artışı <%10 iken p99 artışı >%25",
    "koşullarından ilkiyle işaretlenir. Bu otomatik öneri uygulama SLO'sunun yerine geçmez.",
    generatorLimited.length
      ? `Load-generator CPU'su %${number(generatorCpuLimit)} eşiğine ulaşan kademeler aynı makine sınırı nedeniyle ihtiyatla yorumlanmalıdır.`
      : `Load-generator CPU'sunda %${number(generatorCpuLimit)} eşiğine ulaşan bir kademe görülmedi.`,
    "",
    "## Ayrıntılı matris",
    "",
    "| Route | Conn | RPS median | CV | Avg | p95 | p99 | Render p95 | App CPU | Gen CPU | EL p99 | RSS | Hata |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.aggregates.map(
      (group) =>
        `| ${escapeCell(group.route.title)} | ${group.connections} | ${number(group.rpsMedian)} | %${number(group.rpsCvPercent)} | ${number(group.latencyAverageMedian)} | ${number(group.latencyP95Median)} | ${number(group.latencyP99Median)} | ${number(group.documentRenderP95Median)} ms | %${number(group.appCpuPercentMedian)} | %${number(group.generatorCpuPercentMedian)} | ${number(group.resource.eventLoopP99PeakMs)} ms | ${mib(group.resource.rssPeakBytes)} MiB | ${group.valid ? "0" : "VAR"} |`,
    ),
    "",
    "## Cache ve gateway deneyleri",
    "",
    "| Deney | İstek | Gateway `/items` | Gateway toplam | Sonuç | Açıklama |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...report.cacheExperiments.map(
      (experiment) =>
        `| ${escapeCell(experiment.title)} | ${integer(experiment.requests)} | ${integer(experiment.gatewayItemsRequests)} | ${integer(experiment.gatewayTotalRequests)} | ${experiment.passed ? "GEÇTİ" : "BAŞARISIZ"} | ${escapeCell(experiment.detail)} |`,
    ),
    "",
    "### Cache doğruluk matrisi",
    "",
    "| Topology | Senaryo | İstek | Loader | Koruma oranı | Gecikme | Sonuç |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...(report.cacheAcceptance?.topologies ?? []).flatMap((topology) =>
      topology.scenarios.map(
        (scenario) =>
          `| ${topology.topology} | ${escapeCell(scenario.title)} | ${integer(scenario.requests)} | ${integer(scenario.gatewayRequests)} | ${number(scenario.protectionRatio)}x | ${number(scenario.latencyMs)} ms | ${scenario.passed ? "GEÇTİ" : "BAŞARISIZ"} |`,
      ),
    ),
    "",
    "## Payload ve serialization bütçeleri",
    "",
    "| Route | HTML | Island props toplam | En büyük island props | Sonuç |",
    "| --- | ---: | ---: | ---: | --- |",
    ...(report.payloads ?? []).map((payload) => {
      const passed = (report.payloadBudgetResults ?? [])
        .filter(({ route }) => route === payload.route)
        .every((result) => result.passed);
      return `| ${escapeCell(payload.route)} | ${kib(payload.htmlBytes)} KiB | ${kib(payload.islandPropsBytes)} KiB | ${kib(payload.largestIslandPropsBytes)} KiB | ${passed ? "GEÇTİ" : "BAŞARISIZ"} |`;
    }),
    "",
    `Baseline karşılaştırması: **${baselineStatus(report.baselineComparison)}**.`,
    ...(report.baselineComparison?.incompatibilities?.length
      ? [`Uyumsuzluk: ${report.baselineComparison.incompatibilities.map(escapeCell).join(", ")}`]
      : []),
    ...(baselineFailures.length
      ? [
          "",
          "| Route | Kademe | Metrik | Değişim | Limit |",
          "| --- | ---: | --- | ---: | ---: |",
          ...baselineFailures.map(
            (result) =>
              `| ${escapeCell(result.route)} | ${result.connections ?? "-"} | ${result.metric} | ${signed(result.changePercent)} | %${number(result.limitPercent)} |`,
          ),
        ]
      : []),
    "",
    "## Ortam",
    "",
    `- Node: ${report.environment.node}`,
    `- Platform: ${report.environment.platform} ${report.environment.arch}`,
    `- Mantıksal CPU: ${report.environment.logicalCpuCount}`,
    `- Toplam bellek: ${mib(report.environment.totalMemoryBytes)} MiB`,
    `- Uygulama: ${report.environment.baseUrl}`,
    `- Operations: ${report.environment.opsUrl}`,
    `- Mock gateway: ${report.environment.mockGatewayUrl}`,
    `- Başlangıç load average: ${report.environment.loadAverageStart.map(number).join(" / ")}`,
    `- Bitiş load average: ${report.environment.loadAverageEnd.map(number).join(" / ")}`,
    "",
    "## Metodoloji",
    "",
    `- Bağlantılar: ${report.config.connections.join(", ")}`,
    `- Kademe süresi: ${report.config.durationSeconds} saniye`,
    `- Tekrar: ${report.config.repeats}`,
    `- Route warm-up: ${report.config.warmupSeconds} saniye`,
    "- Her tekrar öncesi tek doğrulama isteği yapılır; beklenen HTTP status dışındaki cevap ölçümü",
    "  geçersiz kılar.",
    "- App CPU/RSS/heap/event-loop değerleri uygulamanın operations `/metrics` endpoint'inden; load",
    "  generator CPU değeri kapasite runner process'inden alınır.",
    "- Cold burst, warm sustained, stale single-flight ve origin data-cache olmayan public API",
    "  karşılaştırmaları ayrıca çalıştırılır.",
    "",
    "Ham tekrarlar, status dağılımları, metric delta'ları ve mock gateway path sayaçları yanındaki",
    "JSON raporundadır.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function coefficientOfVariation(values) {
  const average = sum(values) / values.length;
  if (!average) return 0;
  const variance = sum(values.map((value) => (value - average) ** 2)) / values.length;
  return (Math.sqrt(variance) / average) * 100;
}

function mergeCounts(values) {
  const result = {};
  for (const counts of values) {
    for (const [key, count] of Object.entries(counts)) result[key] = (result[key] ?? 0) + count;
  }
  return result;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function number(value) {
  return Number(value ?? 0).toFixed(1);
}

function integer(value) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function mib(bytes) {
  return number((bytes ?? 0) / 1_048_576);
}

function kib(bytes) {
  return number((bytes ?? 0) / 1_024);
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${number(value)}%`;
}

function baselineStatus(comparison) {
  if (!comparison || comparison.status === "missing") return "BASELINE YOK";
  if (comparison.status === "incompatible") return "UYUMSUZ / KARŞILAŞTIRILMADI";
  if (comparison.status === "inconclusive") return "KARARSIZ / YENİDEN ÇALIŞTIR";
  return comparison.status === "passed" ? "GEÇTİ" : "BAŞARISIZ";
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = Math.round(seconds % 60);
  return [hours ? `${hours} sa` : "", minutes ? `${minutes} dk` : "", `${rest} sn`]
    .filter(Boolean)
    .join(" ");
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
