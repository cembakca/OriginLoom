# ssr-kit load test report

| Alan        | Değer                                  |
| ----------- | -------------------------------------- |
| Suite       | `benchmark`                            |
| Profil      | `memory`                               |
| Başlangıç   | 2026-07-20T09:19:53.197Z               |
| Bitiş       | 2026-07-20T09:26:02.827Z               |
| App URL     | http://127.0.0.1:31005                 |
| Metrics URL | http://127.0.0.1:31090                 |
| App limit   | 2 vCPU / 4 GiB RAM                     |
| Gateway     | mock-gw (contract smoke, not prod SLA) |

## Senaryo sonuçları

| Senaryo                    | RPS (avg) | Latency p50 (ms) | Latency p99 (ms) | Hata % | x-cache              | 5xx/503/504 |
| -------------------------- | --------: | ---------------: | ---------------: | -----: | -------------------- | ----------- |
| warmup-health              |   6250.28 |                0 |                2 |      0 | —                    | —           |
| cache-miss-home            |    1886.8 |               10 |               21 |      0 | HIT (beklenen: MISS) | —           |
| cache-hit-home             |    1737.3 |               25 |               64 |      0 | HIT (beklenen: HIT)  | —           |
| cache-hit-bank             |   1391.28 |               26 |               64 |      0 | HIT (beklenen: HIT)  | —           |
| cache-miss-housing-catalog |   1397.36 |               19 |               47 |      0 | —                    | —           |
| cache-bypass-calculator    |    114.44 |              210 |              373 |      0 | —                    | —           |
| cache-bypass-account       |    1493.2 |               12 |               27 |      0 | —                    | —           |
| cache-short-bist           |   1426.24 |               22 |               59 |      0 | —                    | —           |
| mixed-catalog              |   1496.67 |               34 |              119 |      0 | —                    | —           |
| capacity-ramp              |   1792.97 |               64 |              118 |   0.13 | —                    | 503:72      |
| referral-post              |   2885.74 |                0 |                5 |  99.93 | —                    | —           |

## Yorum rehberi

- **memory profili**: process-local cache; pod restart sonrası soğuk başlangıç davranışını yansıtır.
- **redis profili**: paylaşımlı HTML cache + cold-fill coalescing; çok pod senaryosuna daha yakındır.
- **capacity-ramp** senaryosunda `503`/`504` beklenen sinyallerdir; steady-state senaryolarda sıfıra yakın olmalıdır.
- Gateway mock olduğu için mutlak RPS değerleri prod taahhüdü değildir; profiller arası **göreli fark** ve **hata oranı** önemlidir.

## Metrik snapshot

Ham Prometheus metrikleri `metrics-before.txt` ve `metrics-after.txt` dosyalarındadır.
