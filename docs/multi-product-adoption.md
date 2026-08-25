# 15 Ürün Senaryosu: OriginLoom'u Nasıl Paylaşmalı?

Bu belge, birden fazla Next.js projesinden OriginLoom (Hono + React SSR) altyapısına geçerken
**tek dev proje** veya **15 kopya repo** tuzağına düşmeden nasıl organize olunacağını adım adım
anlatır.

Okuyucu: teknik lider / mimari karar veren; “monorepo”, “semver” gibi kelimeleri biliyor olmak
şart değil — her kavram ilk geçtiği yerde açıklanır.

> **Durum: Faz 0-1 uygulandı.** Repo pnpm workspace'e dönüştü ve platform dört pakete ayrıldı:
> `@originloom/shared` (framework-nötr taban + render kontratı), `@originloom/core` (sunucu
> runtime, React bağımlılığı yok), `@originloom/react` (React adaptörü + island runtime),
> `@originloom/tooling` (bin'ler). Referans ürün `apps/showroom` altındadır ve yeni app'ler
> `pnpm create-app` ile üretilir. Güncel kontrat için
> [ARCHITECTURE.md](../ARCHITECTURE.md#workspace-platform-ve-ürün-ayrımı) ve
> [new-product-app.md](./new-product-app.md); aşağıdaki fazlar kararın gerekçesini ve kalan
> adımları (ürün app'lerinin migrasyonu) anlatır.

---

## 1. Sorun ne?

Elimizde kabaca şu var:

- **15 ayrı web projesi** (yatırım, bilgi merkezi, kredi kartları, …)
- Hepsi **aynı gateway (GW)** ile konuşuyor
- Hepsi Next.js App Router; **dynamic rendering** yüzünden RPS düşüyor
- Bu repodaki **OriginLoom** altyapısı (cache kontratı, middleware, SSR pipeline) sorunu çözüyor

Ama:

| Fikir                               | Neden cazip            | Neden tehlikeli                                                                                       |
| ----------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| 15 projeyi **tek repoda birleştir** | “Tek yerden yönetiriz” | Bir ekip bilgi merkezine hotfix atarken yatırım deploy’u da risk altında; cache/purge/route karmaşası |
| Bu repoyu **15 kez kopyala**        | “Her ürün bağımsız”    | Bir yıl sonra 15 farklı “OriginLoom”; cache bugfix’i 15 yere; kimse güncelleyemez                     |

**İhtiyacımız:** Altyapı **bir kez** yazılsın ve güncellensin; ürün sayfaları **ayrı** kalsın; deploy **ayrı** olsun.

---

## 2. Ana fikir: Motor ile kaporta

Arabayı düşün:

| Parça                                   | OriginLoom karşılığı                                                                                | Kim bakar?     | Ne sıklıkla değişir?           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------- | ------------------------------ |
| **Motor, şanzıman, fren**               | Cache (L1/L2), auth refresh, middleware pipeline, handler, metrics, cold-fill, Pub/Sub invalidation | Platform ekibi | Ayda birkaç kez (bugfix, perf) |
| **Kaporta, iç döşeme, gösterge paneli** | Sayfalar, formlar, ürün listeleri, GTM, route tablosu                                               | Ürün ekibi     | Her sprint                     |
| **Plaka (hangi araba)**                 | `RELEASE_ID`, domain, env, hangi BFF’ler açık                                                       | DevOps + ürün  | Deploy başına                  |

15 farklı araba (yatırım, bilgi merkezi…) **aynı motoru** kullanabilir.  
15 farklı motor üretmek zorunda değilsin.

**Bu repodaki durum today:** Referans “showroom araba” — motor **ve** tüm demo sayfalar **aynı repoda**.  
15 ürüne giderken showroom’u 15 parçaya bölmek değil; **motoru paketleyip** her ürüne ince bir gövde takmak.

---

## 3. Bu repoda ne “motor”, ne “kaporta”?

Aşağıdaki tablo **mevcut dosya ağacına** göredir. “Platform” = paylaşılacak; “Ürün” = her projede farklı.

### 3.1 Platform (paylaşılır — `@corp/origin-core` benzeri)

| Klasör / dosya                                                                  | Ne iş yapar?                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `server/cache/*`                                                                | L1 memory + opsiyonel Redis, tiered store, cold-fill, SWR, purge, invalidation |
| `server/handler.ts`                                                             | İstek → route → cache → loader → render zinciri                                |
| `server/ssr/*`                                                                  | Route çözümleme, cold miss, response                                           |
| `server/middleware/*`                                                           | Auth, session, redirection, CSP, request-id, deadline                          |
| `server/config.ts`, `config-validation.ts`                                      | Env kuralları                                                                  |
| `server/metrics*`, `observability.ts`, `logger.ts`                              | Prometheus, trace, log                                                         |
| `server/app.ts`                                                                 | `createApp()` — Hono uygulamasını kurar                                        |
| `server/document/*`                                                             | HTML iskelet, `<head>`, streaming                                              |
| `server/cache/fragment.tsx`                                                     | Fragment cache **mekanizması** (registry içeriği ürüne özel kalabilir)         |
| `src/lib/island.tsx`, `src/hydrate.client.tsx`, `src/entry.client.tsx`          | Island mimarisi                                                                |
| `packages/origin-tooling/bin/build.mjs`, `dev.mjs`, docker compose yardımcıları | Build / dev orchestration                                                      |
| `tests/server/cache/*`, `handler.test.ts`, `config.test.ts`, …                  | Altyapı testlerinin çoğu                                                       |

**Özet:** Bir isteğin “nasıl işlendiği” — cache hit mi, auth refresh mi, readiness ne — burada.

### 3.2 Ürün (her projede farklı — `investment-web`, `knowledge-web`, …)

| Klasör / dosya                               | Ne iş yapar?                                        |
| -------------------------------------------- | --------------------------------------------------- |
| `server/routes/*`                            | Hangi URL’ler var, loader ne çekiyor, cache key ne  |
| `server/routes/index.ts`                     | Route tablosu (sıra önemli)                         |
| `src/features/*`                             | Sayfa bileşenleri (kredi listesi, makale detayı, …) |
| `src/components/*`                           | UI (çoğu ürün ortak design system’den de gelebilir) |
| `src/lib/cache-keys.ts`                      | **Bu ürünün** hangi sayfaları cache’lenir           |
| `src/routing/rules.ts`                       | Redirect / rewrite kuralları (CMS’ten gelen yollar) |
| `server/api/index.ts` içinde mount edilenler | Ürüne özel BFF (market stream, loan calculator, …)  |
| `server/services/*` (domain)                 | GW’den veri çeken ürün servisleri                   |
| `.env.*`, branding, GTM id                   | Ortam                                               |

**Özet:** “Hangi sayfalar var, ne gösteriyorlar” — burada.

### 3.3 Gri alan (platformda hook, içerik üründe)

| Parça             | Platform sağlar                                                                           | Ürün seçer                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Middleware        | `authStep`, `sessionStep`, `redirectionStep` (sırası sabit) + `defineMiddleware` kontratı | Kendi adımları: `createApp({ middleware })`, phase ve matcher |
| API mount         | `mountApi(app, extensions)`                                                               | Market stream var mı, referral var mı                         |
| Fragment registry | `registerFragment(name, def)` API                                                         | Bilgi merkezinde “popular articles”, yatırımda yok            |
| Route tablosu     | `Route` tipi, `createApp({ routes })`                                                     | Route listesi                                                 |

Zaten `createApp` bunun tohumunu taşıyor:

```typescript
// server/app.ts — bugün
export function createApp(options: CreateAppOptions): Hono {
  const routeTable = options.routes ?? defaultRoutes;
  // ...
}
```

15 ürün modelinde `defaultRoutes` platformda olmaz; her app kendi `routes` dizisini verir.

---

## 4. “15 proje tek repo” ≠ “15 proje tek deploy”

Karıştırılan iki kavram:

### Monorepo (tek Git deposu)

```
origin-platform/
  packages/origin-shared/   ← framework-nötr taban (tipler, routing, render kontratı)
  packages/origin-core/     ← motor (React bilmez)
  packages/origin-react/    ← React adaptörü + islands
  apps/investment-web/      ← yatırım sayfaları
  apps/knowledge-web/       ← bilgi merkezi sayfaları
  apps/credit-cards-web/
```

- **Tek git clone**, tek CI pipeline tanımı (Turborepo / pnpm workspace)
- Platform ekibi `packages/origin-core` değiştirince aynı PR’da bir pilot app’i de güncelleyebilir

### Ayrı deploy (15 image, 15 K8s Deployment)

- `investment-web` → `investment.example.com` → kendi pod’ları, kendi cache namespace’i (`RELEASE_ID`) ve kendi koordinasyon namespace’i (`APP_ID`)
- `knowledge-web` → `bilgi.example.com` → ayrı pod’lar
- **Biri deploy olurken diğeri zorunlu deploy olmaz**

Yani: **Monorepo kullanabilirsiniz; yine de 15 ayrı uygulama olarak çalışır.**  
Bu, “her şeyi tek Next app’te birleştirmek” değildir.

### Multi-repo (15 ayrı Git reposu)

Platform npm paketi olarak publish edilir (`@corp/origin-core@2.3.1`).  
Her ürün reposu `package.json`’da:

```json
{
  "dependencies": {
    "@corp/origin-core": "^2.3.0",
    "@corp/origin-react": "^2.3.0"
  }
}
```

- Ekipler tamamen ayrıysa veya farklı erişim hakları varsa mantıklı
- Platform her release’te npm’e push eder; Renovate bot 15 repoda PR açar

**Hangisi?** Aynı şirket / aynı platform ekibi → **monorepo + ayrı deploy** genelde daha kolay.  
Dış ajans / farklı org → **npm paket + multi-repo**.

---

## 5. Somut örnek: İki ürün yan yana

### Yatırım web (`apps/investment-web`)

```
server/routes/
  bist100.ts          # BIST listesi, kısa TTL cache
  markets-stream.ts   # SSE ile canlı fiyat (BFF açık)
server/routes/index.ts → [bist100, ...]

src/features/markets/...
src/lib/cache-keys.ts  → PageCacheId.bist100, ...

server/index.ts:
  createApp({ routes: investmentRoutes, ... })
  mountApi(app, { marketStream: true, loanCalculator: false })
```

Deploy: `investment-web:release-4821`  
Cache key prefix: `ssr:investment-4821:...`

### Bilgi merkezi (`apps/knowledge-web`)

```
server/routes/
  knowledge-center.ts
  knowledge-article.ts
server/routes/index.ts → [knowledgeCenter, knowledgeArticle, ...]

src/features/knowledge-center/...
src/lib/cache-keys.ts  → PageCacheId.knowledgeCenter, ...

Fragment: popular-knowledge-articles (sadece bu app’te register)

server/index.ts:
  createApp({ routes: knowledgeRoutes, ... })
  mountApi(app, { marketStream: false })
```

Deploy: `knowledge-web:release-1192`  
Gateway **ortak** kalır; her app kendi loader’ında aynı GW URL’ine gider.

**Ortak kalan:** Auth cookie okuma, refresh coordination, cache tiered read/write, `/readyz`, metrics formatı — platform paketinden gelir; **kopyalanmaz**.

---

## 6. “Paket” ne demek? (npm / workspace)

**Paket** = bağımsız versiyonlanabilir kod kutusu.

- Platform ekibi `origin-core`’u düzeltir → `2.4.0` yayınlar
- Yatırım ekibi `package.json`’da `"@corp/origin-core": "2.3.0"` → `"2.4.0"` yapar → test → deploy
- Bilgi merkezi bir hafta sonra yükseltir; acele yok

**Semver (sürüm numarası):** `2.4.0`

- `2.4.1` → bugfix, genelde güvenli güncelleme
- `3.0.0` → breaking change; migration guide okunur

**Asla yapılmaması gereken:** Yatırım reposunda `server/cache/tiered.ts` dosyasını kopyalayıp “bizde biraz farklı” demek. O an fork doğmuş olur.

---

## 7. Bu repodan platforma geçiş — fazlar

### Faz 0 — Sınırları çiz (1–2 hafta, kod taşımadan)

1. Bu belgedeki tabloyu ekipçe onayla: hangi dosya platform, hangisi ürün
2. `createApp` / `mountApi` için eksik hook’ları listele (ör. `routes` zaten var; `mountApi` henüz sabit)
3. Pilot ürün seç: **biri basit** (az sayfa, çok cache), **biri zor** (pagination, fragment, streaming)

### Faz 1 — Paket çıkar (platform ekibi)

```
packages/
  origin-shared/     tipler, routing engine, metadata, render kontratı
  origin-core/       cache, handler, middleware, config, metrics, document orkestrasyonu
  origin-react/      island runtime, server/ render adaptörü, vite preset
  origin-tooling/    build, dev, smoke
```

Bu repo (`origin-loom` showroom) `apps/showroom/` olur veya referans kalır.

**Testler paketle birlikte gider.** App reposu ince smoke yapar.

### Faz 2 — İlk ince app (pilot)

Yeni klasör: sadece

- 3–5 route
- 1 ürünün gerçek sayfaları
- `server/index.ts` ~30–50 satır

Production’a **tek ürün** trafiğiyle cutover; Next ile paralel kısa süre.

### Faz 3 — Starter şablon

`npm create @corp/origin-app` veya GitHub template:

- Boş `routes/index.ts`
- Örnek bir cache’li sayfa
- `.env.development` hazır
- **Tüm repo kopyası değil** — dependency olarak `@corp/origin-core`

### Faz 4 — Dalga dalga migration (15 Next → Origin)

Öncelik sırası önerisi:

1. Yüksek cache hit potansiyeli, düşük kişiselleştirme (katalog, bilgi merkezi listesi)
2. Orta (banka profili, detay sayfaları)
3. Zor (hesaplama, karşılaştırma, heavy client)

Her dalgada: load-test profili, purge playbook, `RELEASE_ID` stratejisi net.

### Faz 5 — Güncel tutma makinesi

| Mekanizma       | Ne sağlar                                                          |
| --------------- | ------------------------------------------------------------------ |
| Platform CI     | Her PR’da cache/auth/handler testleri                              |
| Renovate        | 15 app’te otomatik “origin-core 2.4.0 available” PR                |
| Release notları | “3.0.0: `pingCache` imzası değti”                                  |
| RFC / #platform | Ürün ekipleri cache key’e auth token eklemek istese önce konuşulur |

---

## 8. Günlük hayat: kim ne yapar?

### Platform mühendisi (2–4 kişi)

- Redis invalidation bugfix
- Auth refresh coordination
- Vite / React 19 upgrade
- `origin-core` release
- Pilot app ile entegrasyon testi

### Yatırım ürün mühendisi

- `server/routes/bist100.ts` loader
- `src/features/markets/bist100-page.tsx` UI
- Cache key’e query param eklemek (platform RFC’sine uygun)
- `@corp/origin-core` minor güncellemesini sprint içinde almak

**Ürün mühendisi `tiered.ts` açmaz.** Cache policy route’ta:

```typescript
cache: (ctx) => pageCachePolicy(PageCacheId.bist100, ctx),
loader: async (ctx) => { /* GW fetch */ },
Component: Bist100Page,
```

---

## 9. Sık sorulan sorular

### “15 ayrı Redis mi?”

**Öneri:** Ortak Redis cluster, iki ayrı namespace ekseniyle.

- **`RELEASE_ID`** cache'i ayırır ve her deploy'da değişir. Purge API zaten bu namespace'e göre çalışır.
- **`APP_ID`** koordinasyonu (idempotency, auth refresh, rate limit) ayırır ve hiç değişmez.

`RELEASE_ID` bir ürün kimliği **değildir**; bir dönem ürünleri kazara ayırıyordu, çünkü her uygulama
kendi değerini kullanıyordu. Ayrıntı: üretilen uygulamanın `docs/namespaces.md` dosyası.

Alternatif: kritik izolasyon gerekiyorsa app başına Redis DB index — operasyon kararı.

### “Design system (Button, Header) ortak mı?”

Üçüncü paket olabilir: `@corp/design-system`. OriginLoom’dan bağımsız; 15 Next app’te de zaten ortak olabilir.

### “GW client kodu?”

`server/adapters/gateway.ts` + contract tipleri → `@corp/gateway-client`.  
15 projede zaten benzer fetch katmanı vardır; buraya taşınır.

### “Mock-gw?”

Platform geliştirme aracı; her app reposunda kopya değil, `@corp/origin-dev/mock-gw` veya tek shared compose.

### “Next’i hemen tamamen bırakmak zorunda mıyız?”

Hayır. Hostname bazlı: `bilgi.example.com` → OriginLoom, geri kalan Next.  
Gateway ortak kalır. Dalga dalga.

### “Bu repodaki demo sayfalar ne olacak?”

Showroom / eğitim aracı olarak kalır; production’da 15 app’in hiçbiri tüm route tablosunu import etmez.

---

## 10. Yapılmaması gerekenler (net liste)

1. **15 tam repo kopyası** — bir yıl sonra 15 fork
2. **15 ürünü tek `routes/index.ts`’te birleştirmek** — deploy ve cache felç
3. **Platform kodunu app içine copy-paste** — code review’da red
4. **İlk günden 15 migration** — pilot + starter + dalga
5. **Versiyonsuz “git submodule ile server/cache çekelim”** — submodule güncellemesi npm’ten zor; tercih npm/workspace

---

## 11. Karar özeti (tek paragraf)

OriginLoom’un değeri **sayfa kodunda değil**, isteğin güvenli ve ölçeklenebilir işlenmesinde.  
15 Next projesini **tek deployable’a birleştirmeyin**; bu repoyu **15 kez kopyalamayın**.  
**Platform paketleri** (motor) + **ince ürün uygulamaları** (kaporta) + **ayrı deploy** + **semver ile güncelleme** modelini kurun.  
Monorepo veya npm paket sadece organizasyon tercihi; asıl ayrım **paylaşılan runtime** vs **ürün route/UI** ayrımıdır.

---

## 12. Sonraki somut adım

1. Platform ekibiyle bu belgedeki **§3 tablosunu** satır satır onaylayın
2. Pilot: **bilgi merkezi** veya **BIST/yatırım** — hangisi iş önceliğinizse
3. `createApp` / `mountApi` genişletme listesini issue’ya dökün
4. `packages/origin-core` için ilk extract PR’ını açın (henüz migration yok)

İlgili: [ARCHITECTURE.md](../ARCHITECTURE.md), [docs/conventions.md](./conventions.md)
