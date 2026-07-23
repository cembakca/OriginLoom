# ssr-kit load test report

| Alan        | Değer                                  |
| ----------- | -------------------------------------- |
| Suite       | `benchmark`                            |
| Profil      | `redis`                                |
| Başlangıç   | 2026-07-20T09:10:54.420Z               |
| Bitiş       | 2026-07-20T09:17:23.997Z               |
| App URL     | http://127.0.0.1:31005                 |
| Metrics URL | http://127.0.0.1:31090                 |
| App limit   | 2 vCPU / 4 GiB RAM                     |
| Gateway     | mock-gw (contract smoke, not prod SLA) |

## Senaryo sonuçları

| Senaryo                    | RPS (avg) | Latency p50 (ms) | Latency p99 (ms) | Hata % | x-cache              | 5xx/503/504 |
| -------------------------- | --------: | ---------------: | ---------------: | -----: | -------------------- | ----------- |
| warmup-health              |   4985.82 |                0 |                3 |      0 | —                    | —           |
| cache-miss-home            |   1417.95 |               12 |               35 |      0 | HIT (beklenen: MISS) | —           |
| cache-hit-home             |   1546.44 |               29 |               71 |      0 | HIT (beklenen: HIT)  | —           |
| cache-hit-bank             |   1339.72 |               27 |               64 |      0 | HIT (beklenen: HIT)  | —           |
| cache-miss-housing-catalog |   1246.41 |               22 |               47 |      0 | —                    | —           |
| cache-bypass-calculator    |    121.96 |              196 |              356 |      0 | —                    | —           |
| cache-bypass-account       |      1540 |               11 |               29 |      0 | —                    | —           |
| cache-short-bist           |    1340.8 |               24 |               50 |      0 | —                    | —           |
| mixed-catalog              |   1663.27 |               33 |               64 |      0 | —                    | —           |
| capacity-ramp              |    2450.9 |               16 |              202 |  56.65 | —                    | 503:41645   |
| referral-post              |   3774.67 |                0 |                2 |  99.95 | —                    | —           |

## Yorum rehberi

- **memory profili**: process-local cache; pod restart sonrası soğuk başlangıç davranışını yansıtır.
- **redis profili**: paylaşımlı HTML cache + cold-fill coalescing; çok pod senaryosuna daha yakındır.
- **capacity-ramp** senaryosunda `503`/`504` beklenen sinyallerdir; steady-state senaryolarda sıfıra yakın olmalıdır.
- Gateway mock olduğu için mutlak RPS değerleri prod taahhüdü değildir; profiller arası **göreli fark** ve **hata oranı** önemlidir.

## Metrik snapshot

Ham Prometheus metrikleri `metrics-before.txt` ve `metrics-after.txt` dosyalarındadır.
