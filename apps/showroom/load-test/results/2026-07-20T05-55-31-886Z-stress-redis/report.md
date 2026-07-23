# ssr-kit stress test report

| Alan        | Değer                                  |
| ----------- | -------------------------------------- |
| Suite       | `stress`                               |
| Profil      | `redis`                                |
| Başlangıç   | 2026-07-20T05:55:31.886Z               |
| Bitiş       | 2026-07-20T06:13:21.849Z               |
| App URL     | http://127.0.0.1:31005                 |
| Metrics URL | http://127.0.0.1:31090                 |
| App limit   | 2 vCPU / 4 GiB RAM                     |
| Gateway     | mock-gw (contract smoke, not prod SLA) |

## Senaryo sonuçları

| Senaryo                        | RPS (avg) | Latency p50 (ms) | Latency p99 (ms) | Hata % | x-cache | 5xx/503/504 |
| ------------------------------ | --------: | ---------------: | ---------------: | -----: | ------- | ----------- |
| stress-baseline                |   5488.34 |                1 |                4 |      0 | —       | —           |
| stress-ssr-saturation          |    4433.2 |               59 |              500 |  96.37 | —       | 503:512624  |
| stress-bypass-calculator-storm |     990.2 |               69 |              886 |  89.45 | —       | 503:79713   |
| stress-cache-stampede          |   3349.46 |               40 |              429 |  92.67 | —       | 503:232768  |
| stress-mixed-hostile           |   3999.39 |               36 |              404 |  93.34 | —       | 503:671907  |
| stress-capacity-ramp-c96       |   1480.54 |               62 |              100 |      0 | —       | —           |
| stress-capacity-ramp-c192      |    3758.6 |               24 |              281 |  88.79 | —       | 503:200207  |
| stress-capacity-ramp-c384      |   4341.25 |               61 |              518 |   96.4 | —       | 503:376610  |
| stress-capacity-ramp-c512      |   4491.94 |               87 |              591 |  97.53 | —       | 503:328538  |
| stress-deadline-hammer         |   2529.13 |              102 |              237 |  62.15 | —       | 503:141439  |
| stress-recovery                |   1542.25 |               14 |               30 |      0 | —       | —           |

## Yorum rehberi

- **stress suite**: Bilinçli kapasite aşımı — `503`/`504` burada **başarı sinyali** (limitler çalışıyor).
- **stress-recovery**: Soğuma sonrası hata <%1 ve 503 yok olmalı; aksi halde kalıcı degradasyon var.
- **stress-capacity-ramp**: Her fazda 503 oranı artmalı; 512 bağlantıda queue+concurrency tamamen dolmalı.
- mock-gw darboğaz olabilir; asıl hedef SSR admission/deadline davranışıdır.

- **memory profili**: process-local cache; pod restart sonrası soğuk başlangıç davranışını yansıtır.
- **redis profili**: paylaşımlı HTML cache + cold-fill coalescing; çok pod senaryosuna daha yakındır.
- **capacity-ramp** senaryosunda `503`/`504` beklenen sinyallerdir; steady-state senaryolarda sıfıra yakın olmalıdır.
- Gateway mock olduğu için mutlak RPS değerleri prod taahhüdü değildir; profiller arası **göreli fark** ve **hata oranı** önemlidir.

## Metrik snapshot

Ham Prometheus metrikleri `metrics-before.txt` ve `metrics-after.txt` dosyalarındadır.
