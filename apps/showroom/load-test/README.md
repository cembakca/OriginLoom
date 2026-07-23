# Load testing

Bu klasör, OriginLoom için **Docker üzerinde kaynak sınırlı** (app: **2 vCPU / 4 GiB RAM**) gerçek yük
testi koşturur. Gateway mock kalır; amaç prod SLA değil, **cache profili karşılaştırması** ve
**kapasite sinyalleri** (503/504, metrikler) toplamaktır.

## Profiller

| Profil                    | Cache                            | Compose                                                 |
| ------------------------- | -------------------------------- | ------------------------------------------------------- |
| `memory`                  | L1-only (`CACHE_BACKEND=memory`) | `compose.yml` + `compose.memory.yml`                    |
| `redis`                   | L1 + L2 (`CACHE_BACKEND=redis`)  | `compose.yml` + `compose.redis.yml` + `--profile redis` |
| `redis-fallback` (manuel) | L1+L2, `CACHE_REQUIRED=false`    | + `compose.redis-optional.yml` — Redis durdurma testi   |

## Hızlı başlangıç

Önkoşul: Docker Desktop / Docker Engine çalışır durumda, en az 6–8 GiB boş RAM (app 4 GiB + yardımcı servisler).

```bash
# Tam suite — memory (~15–25 dk)
pnpm loadtest:memory

# Tam suite — redis (~15–25 dk)
pnpm loadtest:redis

# Kısa smoke subset (~5 dk)
pnpm loadtest:memory -- --quick
pnpm loadtest:redis -- --quick

# Image zaten build edildiyse
pnpm loadtest:redis -- --skip-build

# Stack'i ayakta bırak (debug)
pnpm loadtest:memory -- --keep-stack
```

Sonuçlar: `load-test/results/<timestamp>-<profile>/`

- `report.md` — özet tablo
- `results.json` — ham sayılar
- `metrics-before.txt` / `metrics-after.txt` — Prometheus scrape

Stack ayaktayken güvenlik smoke:

```bash
pnpm pentest:readiness:loadtest
```

İki profil koşturulduktan sonra karşılaştırma:

```bash
pnpm loadtest:compare
pnpm stress:compare
```

## Senaryo matrisi

| ID                           | Amaç                              |
| ---------------------------- | --------------------------------- |
| `warmup-health`              | Liveness baseline                 |
| `cache-miss-home`            | Soğuk/full SSR + shell            |
| `cache-hit-home`             | Shared page HIT                   |
| `cache-hit-bank`             | Düşük cardinality shared profil   |
| `cache-miss-housing-catalog` | Query-key'li katalog              |
| `cache-bypass-calculator`    | BYPASS, yüksek cardinality        |
| `cache-bypass-account`       | Kişisel neverCache shell          |
| `cache-short-bist`           | Kısa TTL shared snapshot          |
| `mixed-catalog`              | Karışık browse trafiği            |
| `capacity-ramp`              | SSR capacity / deadline stresi    |
| `referral-post`              | Same-origin BFF POST (düşük oran) |

## Yorumlama

1. **memory vs redis**: Tiered mimaride redis profili L2 paylaşımı ve dağıtık cold-fill ölçer; memory profili tek pod L1-only davranışını yansıtır. Sıcak L1+Redis yolunda Redis GET yapılmaması beklenir — eski load test raporları birebir karşılaştırılamaz.
2. **capacity-ramp**: Bilinçli stres — `503` (queue/full) ve `504` (deadline) burada beklenen sinyallerdir.
3. **Mutlak RPS**: mock gateway ve tek container limiti nedeniyle prod taahhüdü değildir.
4. **Metrikler**: `ssr_ssr_capacity_rejected_total`, `ssr_request_timeout_total`,
   `ssr_cache_response_duration_milliseconds` rapor sonrası incelenmelidir.

## Organizasyon önerisi

Release öncesi döngü:

1. `pnpm loadtest:memory` ve `pnpm loadtest:redis` ardışık çalıştır.
2. `report.md` dosyalarını `load-test/results/` altında sakla (gitignore'da).
3. p99 regresyonu > %20 ise SSR capacity, gateway timeout veya cache key cardinality incele.
4. Staging'de (gerçek gateway, gerçek Redis cluster) aynı senaryo URL'leriyle tekrarla — mutlak sayılar
   ancak o ortamda anlam kazanır.

Detaylı metodoloji: [docs/load-testing.md](../docs/load-testing.md)

## Stres testi (ciddi)

Benchmark suite regresyon içindir. **Kapasite kırma** için ayrı stress suite:

```bash
# Tam stress (~25–40 dk)
pnpm stress:memory
pnpm stress:redis

# Hızlı stress (~12–18 dk)
pnpm stress:memory -- --quick
```

| Senaryo                          | Ne yapar                                      |
| -------------------------------- | --------------------------------------------- |
| `stress-ssr-saturation`          | 384 conn / 2 dk tek route — queue dolumu      |
| `stress-bypass-calculator-storm` | 120 benzersiz BYPASS URL, 220 conn            |
| `stress-cache-stampede`          | 100 benzersiz katalog key — cold-fill baskısı |
| `stress-mixed-hostile`           | HIT+BYPASS+hesabım, 256 conn / 3 dk soak      |
| `stress-capacity-ramp`           | 96 → 512 conn kademeli ramp                   |
| `stress-deadline-hammer`         | BYPASS deadline avı, 300 conn                 |
| `stress-recovery`                | Soğuma — hata <%1 olmalı                      |

503/504 stress fazlarında **beklenen** sinyallerdir. `stress-recovery` temiz değilse kalıcı sorun vardır.

**Not:** Redis stress'te yüksek req/s + yüksek hata oranı genelde ucuz **503** reddidir; memory'de
aynı yükte daha çok 2xx görülmesi cache HIT'in process-local olmasından kaynaklanır — prod
multi-pod için Redis doğru seçimdir.
