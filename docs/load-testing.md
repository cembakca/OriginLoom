# Load testing metodolojisi

Bu belge, `load-test/` klasöründeki Docker tabanlı yük testi organizasyonunun **neden**, **nasıl** ve
**ne zaman** çalıştırılacağını tanımlar. Amaç prod SLA taahhüdü değil; release öncesi **regresyon
sinyali**, **cache profili karşılaştırması** ve **kapasite sınırları** (503/504) hakkında kanıt
toplamaktır.

## Amaç ve kapsam dışı

| Dahil                                 | Kapsam dışı                     |
| ------------------------------------- | ------------------------------- |
| Production build (`pnpm build` image) | Gerçek gateway latency/contract |
| App container: **2 vCPU / 4 GiB**     | Çok pod / horizontal scale      |
| mock-gw ile uçtan uca SSR             | CDN / edge cache                |
| memory vs redis cache profili         | Finans prod cutover onayı       |

Mutlak RPS sayıları yalnızca staging (gerçek gateway + cluster Redis) tekrarında anlam kazanır.
Buradaki değerler **göreli karşılaştırma** içindir.

## Ortam topolojisi

```mermaid
flowchart LR
  AC[autocannon host] --> APP[OriginLoom app\n2 CPU / 4 GiB]
  APP --> GW[mock-gw]
  APP --> R[(Redis\nredis profili)]
  AC --> MET[metrics :9090]
  APP --> MET
```

- **Public**: `http://127.0.0.1:31005` (override: `LOADTEST_APP_PORT`)
- **Metrics**: `http://127.0.0.1:31090` (override: `LOADTEST_METRICS_PORT`)
- Compose dosyaları: `load-test/compose.yml` + profil override

## Profiller

### memory (L1-only)

- `CACHE_BACKEND=memory`, Redis yok
- Tek pod / restart sonrası soğuk davranışa yakın
- `APP_ENV=loadtest` ile production build + L1-only cache

### redis (L1 + L2)

- `CACHE_BACKEND=redis`, `REDIS_URL` zorunlu (profilde)
- Paylaşımlı L2 HTML cache + cold-fill da distributed lock + Pub/Sub L1 invalidation
- Sıcak L1 hit'te Redis GET yapılmaması beklenir — eski tek-store Redis profili sonuçlarıyla birebir karşılaştırılamaz

### redis-fallback (manuel senaryo)

Opsiyonel L2 kesintisi doğrulaması — otomatik suite'e dahil değil:

1. `load-test/compose.redis-optional.yml` ile `CACHE_REQUIRED=false` stack başlat
2. `cache-hit-home` senaryosu ile L1'i ısıt
3. Redis container'ını durdur (`docker compose stop redis`)
4. Aynı senaryoyu tekrar koştur — **5xx olmamalı**, `x-cache: HIT` L1'den gelmeli
5. Redis yeniden başlatıldığında subscriber reconnect L1'i flush eder (kaçırılmış invalidation güvenliği)

Her release adayında **her iki profil de** ardışık koşturulmalı; sonuçlar `load-test/results/`
altında saklanır (gitignore).

## Senaryo matrisi

Senaryolar `load-test/scenarios.mjs` içinde sıralıdır; cache HIT ölçümlerinden önce warmup yapılır.

| Grup          | Senaryolar                                                                | İzlenecek sinyal                                                        |
| ------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Baseline      | `warmup-health`                                                           | Liveness, düşük latency                                                 |
| Shared cache  | `cache-miss-home`, `cache-hit-home`, `cache-hit-bank`, `cache-short-bist` | `x-cache`, p99, HIT oranı                                               |
| Fragmentation | `cache-miss-housing-catalog`, `mixed-catalog`                             | Query key cardinality                                                   |
| BYPASS        | `cache-bypass-calculator`, `cache-bypass-account`                         | SSR yükü, gateway çağrıları                                             |
| Kapasite      | `capacity-ramp`                                                           | `503`, `504`, `ssr_ssr_capacity_rejected_total`                         |
| BFF           | `referral-post`                                                           | Same-origin guard; başarılı yanıt **303** (autocannon'da hata sayılmaz) |

## Referans kapasite (tek pod, 2 vCPU / 4 GiB, mock-gw)

Stress koşularından türetilmiş **üst limit tahminleri** — prod gateway ile %20–40 düşebilir.

| Profil / trafik              |    Rahat çalışma |                        Sert tavan |
| ---------------------------- | ---------------: | --------------------------------: |
| Hard concurrent SSR          |                — |             **96** (32+64 kuyruk) |
| Memory + cache HIT (L1-only) |     ~1.200 req/s |                      ~1.600 req/s |
| L1+Redis sıcak L1 HIT        |     ~1.200 req/s |                      ~1.600 req/s |
| L1+Redis soğuk L2 miss       | ~800–1.000 req/s | ~1.480 req/s (yüksek conn'da 503) |
| BYPASS rotalar               |    ~80–100 req/s |                        ~150 req/s |
| Karışık (finans benzeri)     | ~800–1.000 req/s |                      ~1.200 req/s |

Redis profili (L1+L2) ~96 eşzamanlı SSR altında L1-only ile benzer steady-state HIT davranışı gösterir;
soğuk pod / L2 miss path'te ek round-trip nedeniyle daha erken 503 üretebilir.

Karşılaştırma:

```bash
pnpm loadtest:compare      # benchmark
pnpm stress:compare        # stress
```

## Çalıştırma

```bash
# Tam suite (~15–25 dk / profil)
pnpm loadtest:memory
pnpm loadtest:redis

# Hızlı smoke (~5 dk)
pnpm loadtest:memory -- --quick

# Image zaten var
pnpm loadtest:redis -- --skip-build

# Stack debug
pnpm loadtest:memory -- --keep-stack
```

## Raporlama

Her koşu `load-test/results/<timestamp>-<profile>/` oluşturur:

| Dosya                                      | İçerik                    |
| ------------------------------------------ | ------------------------- |
| `report.md`                                | Özet tablo, yorum rehberi |
| `results.json`                             | Ham autocannon + meta     |
| `metrics-before.txt` / `metrics-after.txt` | Prometheus scrape         |
| `preflight.json`                           | İlk istek header örneği   |

### Kabul eşikleri (regresyon)

Staging gate öncesi iç kontrol önerisi:

1. Steady-state senaryolarda (`cache-hit-*`, `mixed-catalog`) hata oranı **< %1**
2. `capacity-ramp` dışında **504** yok; `503` yalnızca bilinçli stres senaryosunda
3. Aynı senaryoda redis profili p99, memory'ye göre anlamlı iyileşme göstermeli (soğuk start hariç) — **tiered mimari ölçümü**: sıcak L1+Redis yolunda Redis GET sayısı düşük olmalı
4. p99 bir önceki release'e göre **>%20** kötüleşme → SSR capacity, gateway timeout veya cache key incelemesi
5. `ssr_gateway_invalid_payload_total` artışı yok
6. Redis kesintisi fallback manuel senaryosunda steady-state **5xx** yok

## Release döngüsü önerisi

1. CI yeşil (`pnpm ci`)
2. `loadtest:memory` + `loadtest:redis` ardışık
3. Raporları release ticket'a ekle
4. Staging'de aynı URL seti + gerçek gateway ile tekrar (mutlak sayılar)
5. Pentest readiness (`pnpm pentest:readiness`) staging URL ile

## Stres testi (stress suite)

Benchmark suite (`loadtest:*`) steady-state regresyon içindir. **Ciddi stres** için ayrı suite:

```bash
pnpm stress:memory
pnpm stress:redis
pnpm stress:memory -- --quick
```

Stress suite bilinçli olarak `SSR_MAX_CONCURRENCY=32` + `SSR_MAX_QUEUE=64` sınırını aşar (384–512
eşzamanlı bağlantı). Beklenen sinyaller: `503` (capacity rejected), `504` (deadline). Soğuma
senaryosu (`stress-recovery`) sonrası hata oranı <%1 olmalıdır.

| Faz                | Bağlantı |  Süre | Amaç                                |
| ------------------ | -------: | ----: | ----------------------------------- |
| SSR saturation     |      384 |  120s | Tek route queue dolumu              |
| BYPASS storm       |      220 |   90s | Gateway + SSR bypass yükü           |
| Cache stampede     |      240 |   75s | Benzersiz query key cold-fill       |
| Mixed hostile soak |      256 |  180s | Karışık trafik altında dayanıklılık |
| Capacity ramp      |   96→512 | 4 faz | Kademeli kırılma noktası            |
| Recovery           |       24 |   45s | Steady-state'e dönüş doğrulama      |

Sonuçlar: `load-test/results/<timestamp>-stress-<profile>/`

İlgili: [load-test/README.md](../apps/showroom/load-test/README.md), [production-security.md](./production-security.md),
[pentest-prep.md](./pentest-prep.md)
