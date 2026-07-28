# ssr-kit stress test report

| Alan        | Değer                                  |
| ----------- | -------------------------------------- |
| Suite       | `stress`                               |
| Profil      | `memory`                               |
| Başlangıç   | 2026-07-20T06:47:19.371Z               |
| Bitiş       | 2026-07-20T07:05:11.034Z               |
| App URL     | http://127.0.0.1:31005                 |
| Metrics URL | http://127.0.0.1:31090                 |
| App limit   | 2 vCPU / 4 GiB RAM                     |
| Gateway     | mock-gw (contract smoke, not prod SLA) |

## Senaryo sonuçları

| Senaryo                        | RPS (avg) | Latency p50 (ms) | Latency p99 (ms) | Hata % | x-cache | 5xx/503/504 |
| ------------------------------ | --------: | ---------------: | ---------------: | -----: | ------- | ----------- |
| stress-baseline                |   5930.54 |                1 |                4 |      0 | —       | —           |
| stress-ssr-saturation          |   1636.69 |              168 |              312 |   1.76 | —       | 503:1427    |
| stress-bypass-calculator-storm |    672.43 |              266 |             1073 |  85.59 | —       | 503:51800   |
| stress-cache-stampede          |      1366 |              167 |              331 |   1.37 | —       | 503:1406    |
| stress-mixed-hostile           |   1572.23 |              151 |              325 |   0.49 | —       | 503:1389    |
| stress-capacity-ramp-c96       |   1473.47 |               57 |              143 |      0 | —       | —           |
| stress-capacity-ramp-c192      |   1557.69 |              117 |              214 |   0.21 | —       | 503:192     |
| stress-capacity-ramp-c384      |   1389.43 |              252 |              653 |   1.26 | —       | 503:1577    |
| stress-capacity-ramp-c512      |    1407.5 |              241 |              463 |   2.87 | —       | 503:858     |
| stress-deadline-hammer         |   1198.06 |              221 |              551 |   1.04 | —       | 503:1116    |
| stress-recovery                |   1571.58 |               13 |               33 |      0 | —       | —           |

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
