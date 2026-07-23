import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @param {object} input
 * @param {string} input.outputDir
 * @param {string} input.profile
 * @param {string} [input.suite]
 * @param {object} input.meta
 * @param {object[]} input.results
 * @param {object} input.metricsBefore
 * @param {object} input.metricsAfter
 */
export async function writeReport({
  outputDir,
  profile,
  suite,
  meta,
  results,
  metricsBefore,
  metricsAfter,
}) {
  await mkdir(outputDir, { recursive: true });

  const payload = {
    profile,
    suite: suite ?? "benchmark",
    meta,
    results,
    metrics: { before: metricsBefore, after: metricsAfter },
  };

  await writeFile(
    path.join(outputDir, "results.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(outputDir, "report.md"), renderMarkdown(payload), "utf8");
  await writeFile(path.join(outputDir, "metrics-before.txt"), metricsBefore.raw, "utf8");
  await writeFile(path.join(outputDir, "metrics-after.txt"), metricsAfter.raw, "utf8");
}

/**
 * @param {object} payload
 */
function renderMarkdown(payload) {
  const lines = [
    `# OriginLoom ${payload.suite === "stress" ? "stress test" : "load test"} report`,
    "",
    "| Alan | Değer |",
    "| --- | --- |",
    `| Suite | \`${payload.suite}\` |`,
    `| Profil | \`${payload.profile}\` |`,
    `| Başlangıç | ${payload.meta.startedAt} |`,
    `| Bitiş | ${payload.meta.finishedAt} |`,
    `| App URL | ${payload.meta.appUrl} |`,
    `| Metrics URL | ${payload.meta.metricsUrl} |`,
    "| App limit | 2 vCPU / 4 GiB RAM |",
    "| Gateway | mock-gw (contract smoke, not prod SLA) |",
    "",
    "## Senaryo sonuçları",
    "",
    "| Senaryo | RPS (avg) | Latency p50 (ms) | Latency p99 (ms) | Hata % | x-cache | 5xx/503/504 |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const result of payload.results) {
    const codes = result.statusCodes ?? {};
    const serverErrors =
      Object.entries(codes)
        .filter(([code]) => Number(code) >= 500)
        .map(([code, count]) => `${code}:${count}`)
        .join(", ") || "—";
    const cacheHint =
      result.observedCache != null
        ? `${result.observedCache}${result.expectedCache ? ` (beklenen: ${result.expectedCache})` : ""}`
        : "—";
    lines.push(
      `| ${result.id} | ${result.requests.average} | ${result.latency.p50} | ${result.latency.p99} | ${result.errors.ratePct} | ${cacheHint} | ${serverErrors} |`,
    );
  }

  lines.push(
    "",
    "## Yorum rehberi",
    "",
    ...(payload.suite === "stress"
      ? [
          "- **stress suite**: Bilinçli kapasite aşımı — `503`/`504` burada **başarı sinyali** (limitler çalışıyor).",
          "- **stress-recovery**: Soğuma sonrası hata <%1 ve 503 yok olmalı; aksi halde kalıcı degradasyon var.",
          "- **stress-capacity-ramp**: Her fazda 503 oranı artmalı; 512 bağlantıda queue+concurrency tamamen dolmalı.",
          "- mock-gw darboğaz olabilir; asıl hedef SSR admission/deadline davranışıdır.",
          "",
        ]
      : []),
    "- **memory profili**: process-local cache; pod restart sonrası soğuk başlangıç davranışını yansıtır.",
    "- **redis profili**: paylaşımlı HTML cache + cold-fill coalescing; çok pod senaryosuna daha yakındır.",
    "- **capacity-ramp** senaryosunda `503`/`504` beklenen sinyallerdir; steady-state senaryolarda sıfıra yakın olmalıdır.",
    "- Gateway mock olduğu için mutlak RPS değerleri prod taahhüdü değildir; profiller arası **göreli fark** ve **hata oranı** önemlidir.",
    "",
    "## Metrik snapshot",
    "",
    "Ham Prometheus metrikleri `metrics-before.txt` ve `metrics-after.txt` dosyalarındadır.",
    "",
  );

  return `${lines.join("\n")}\n`;
}
