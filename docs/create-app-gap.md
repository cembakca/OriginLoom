# `create-app` ile showroom arasındaki fark

Showroom platformun her yeteneğini kullanan referans üründür; `origin-create-app` ise çalışan ama
ince bir iskelet üretir. Bu belge farkı **tek tek** çıkarır ve her kalem için "üretilene eklensin
mi" kararını kayda geçirir.

Ölçüm (2026-07-27): showroom `server/` altında 55 dosya, üretilen app'te 12. Showroom'un
`@originloom/core`'dan kullandığı 19 modül üretilen şablonlarda hiç geçmiyor.

---

## A. Platform yeteneği var, örneği yok → **eklenmeli**

Bunlar platformun sunduğu ama üretilen uygulamada hiçbir izi olmayan şeyler. Sonuç: ekip özelliğin
var olduğunu bilmiyor ya da sıfırdan, yanlış kuruyor.

### A1. Gateway'den veri çekme — **en kritik**

|                   | Showroom                                                                 | Üretilen app                          |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| Çağrı             | `gatewayFetch` (`@originloom/core/adapters/gateway`)                     | yok                                   |
| Payload doğrulama | `readGatewayJson` + `requireGatewayPayload`                              | yok                                   |
| Runtime guard'lar | `services/gateway-guards.ts` (`isRecord`, `isString`, `MAX_COLLECTION`…) | yok                                   |
| Örnek servis      | `services/financial-products.ts`                                         | `services/items.ts` — bellekteki dizi |

Üretilen app'in hiçbir loader'ı upstream'e gitmiyor; `.env`'deki `GATEWAY_URL` kullanılmıyor ve
`origin-dev` her açılışta "Gateway: … (start it yourself)" yazıyor. Yani platformun **en çok
kullanılacak** yeteneğinin örneği yok.

### A2. Mock gateway (upstream olmadan geliştirme)

Showroom `tests/fixtures/gateway/` altında 14 dosyalık bir mock GW taşır (`pnpm mock-gw`) ve smoke
testi bununla hermetik çalışır. Üretilen app'te yok → A1'i eklersek ekip ilk gün "gateway nerede"
sorusuna çarpar.

### A3. SEO route'ları — robots.txt / sitemap.xml

Showroom `server/seo.ts` + `services/sitemap.ts` ile `mounts.seo` üzerinden mount eder. Üretilen
app `mounts: { api }` verir, SEO yok. Arama motoruna açılacak her ürün için gerekli.

### A4. Cache purge API

`@originloom/core/cache/purge` + showroom'da `api/internal/cache-purge.ts` (secret korumalı).
Üretilen app'te yok — deploy sonrası cache boşaltma yolu yok.

### A5. Ürün metrikleri

`OriginRuntime.metricSources` alanı ve `@originloom/core/metrics/primitives` ile uygulama kendi
metriklerini `/metrics` çıktısına ekleyebiliyor. Showroom iki kaynak veriyor; üretilen app hiç.

### A6. Ürün env'i ve doğrulaması

Showroom `server/product/config.ts` içinde kendi env'ini okur ve `validateConfig`'e ek doğrulama
geçer (`@originloom/core/config-validation`). Üretilen app'te böyle bir dosya yok; ekip env
eklemek istediğinde kalıbı göremiyor.

### A7. OpenTelemetry

Showroom `server/index.ts` başında `register()` çağırır, kapanışta `shutdownInstrumentation()`.
Üretilen app'te yok → tracing kapalı ve nasıl açılacağı görünmüyor.

### A8. Auth akışı örneği

Auth middleware (token yenileme, cookie jar) **her** uygulamada zaten çalışıyor, ama showroom'daki
BFF uçları (`api/internal/auth-bff.ts`, `auth-session.ts`, `services/user.ts`) üretilen app'te yok.
Sonuç: "giriş yapmış kullanıcı" akışının nasıl kurulacağına dair örnek yok — `account` route'u
sadece tarayıcıda saat gösteren bir defer island.

### A9. Güvenlik yardımcıları

`security/rate-limit`, `security/public-api-guard`, `security/secrets` ve
`middleware/security`'nin `registerCspScriptHashes`'i showroom'da kullanılıyor; üretilen app'te
hiçbiri geçmiyor. Public bir API ucu ekleyen ekip bunları bilmeden yazacak.

### A10. Medya / ikon pipeline

`pnpm icons` (SVG → bileşen) ve `pnpm media` (görsel/font manifest'i, `@originloom/core/media`)
showroom'da script; üretilen app'te ikisi de yok.

---

## B. Ops varlıkları → **tercihe bağlı, bayrakla verilebilir**

| Varlık                                                                              | Showroom                                  | Üretilen app                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| `Dockerfile`                                                                        | var                                       | **var**                                   |
| `docker-compose.yml` (+ redis overlay)                                              | var                                       | yok                                       |
| k8s manifestleri (deployment, hpa, ingress, pdb, network-policy, prometheus-rules…) | 12 dosya                                  | yok                                       |
| load-test + stress + karşılaştırma                                                  | `load-test/`                              | yok                                       |
| pentest hazırlık scriptleri                                                         | `scripts/`                                | yok                                       |
| CI workflow                                                                         | repo kökünde                              | yok (üretilen app kendi CI'ını taşımıyor) |
| Redis ile lokal çalışma                                                             | `dev:redis`, `start:local:redis`, compose | yok (yalnız memory)                       |

Hepsini her uygulamaya basmak şişkinlik yaratır; `--with-ops` gibi bir bayrak veya ayrı bir
"production hardening" belgesi daha uygun olabilir.

---

## C. Platformda düzeltilmesi gereken sızıntı

### C1. `gateway-payload` showroom'un domain'lerini hardcode ediyor

`packages/origin-core/src/gateway-payload.ts` içindeki `GatewayPayloadContract` kapalı bir union:

```ts
"account" |
  "auth_refresh" |
  "blogs" |
  "credit_cards" |
  "finance_referral" |
  "finance_tools" |
  "housing_loans" |
  "knowledge_center" |
  "markets" |
  "popular_blogs" |
  "menu" |
  "offers" |
  "page" |
  "profile" |
  "redirect" |
  "route_domains" |
  "sitemap";
```

Byte bütçeleri de aynı listeye bağlı. Yani **yeni bir ürün kendi contract'ını platformu
değiştirmeden ekleyemez** — `credit_cards` gibi başkasının domain adını kullanmak zorunda kalır.
A1'i (gateway örneği) eklemenin önünde duran ilk engel budur; contract'ın uygulama tarafından
tanımlanabilir olması gerekir.

### C2. `.env` görünürlüğü

Showroom'un `.env.development`'ında olup üretilende olmayan ~30 değişken var (SSR timeout/capacity,
cache fill, client-error rate limit, bot analytics…). Bunların core'da makul varsayılanları var, o
yüzden **hata değil**; ama ekip hangi düğmelerin bulunduğunu göremiyor. Yorum satırı olarak
eklenmesi yeterli.

---

## D. Doğru şekilde yok — eklenmemeli

Bunlar showroom'un ürün içeriği; platform yeteneği değil:

- Finansal domain servisleri (kredi kartı, konut kredisi, piyasa verisi, bilgi merkezi)
- Market-stream SSE hub'ı ve admission kontrolü
- Referral akışı ve istatistik ucu
- GTM/dataLayer bootstrap, site doğrulama meta'ları (google/bing/yandex)
- Bot analytics dispatcher
- Showroom'a özgü routing kuralları, cache-key registry içeriği, Türkçe içerik

---

## Öneri: iki aşama

**Aşama 1 — "gerçek bir ürün gibi" iskelet (A1-A5 + C1)**
Gateway'den veri çeken bir route, mock gateway, SEO uçları, cache purge ve ürün metriği. Bunlar
birlikte "bu platformla gerçek bir ürün nasıl yazılır" sorusunu cevaplar. C1 önce çözülmeli, yoksa
A1 örneği platformu düzenlemeden yazılamaz.

**Aşama 2 — opsiyoneller (A6-A10 + B)**
Ürün config'i, OTel, auth örneği, güvenlik yardımcıları, medya pipeline'ı ve ops varlıkları.
Bayrakla (`--with-ops`) veya belgeye referansla verilebilir.
