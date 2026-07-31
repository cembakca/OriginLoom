# Analytics: dataLayer ve sıra

dataLayer bir çanta değil, **sıralı bir kontrattır**. `gtm.dom`'da çalışan bir tag, o an katmanda ne
varsa onu okur; sayfa görüntüleme ondan sonra gelirse hit boyutsuz gider — ve hiçbir şey hata vermez.
Bu yüzden sıra varsayılmaz, test edilir (`packages/origin-shared` → `analytics-order.test.ts`).

## Sıra

| #   | Ne                                        | Nerede                                          |
| --- | ----------------------------------------- | ----------------------------------------------- |
| 1   | Consent (`efilli.consent`, `..._granted`) | head, `analyticsSequence` 1. adım               |
| 2   | `{ userTrackingId }` — **event yok**      | head, 2. adım (cookie'den, tarayıcıda)          |
| 3   | `gtm.js`                                  | head, 4. adım                                   |
| 4   | `originalLocation`                        | React, `pushPageView`                           |
| 5   | `GAVirtual` (sayfa görüntüleme)           | React, `pushPageView`                           |
| 6   | Ürün olayları (promo impression vb.)      | React, `trackEvent`                             |
| 7   | `gtm.dom`                                 | GTM — **kuyrukta tutulur**, 5'ten sonra salınır |
| 8   | `gtm.load`                                | GTM — aynı şekilde                              |

Gerçek bir çıktı böyle görünür:

```js
{ event: "efilli.consent", categories: {…} }
{ event: "efilli_essential_granted" }
{ hkUserTrackingId: "d1195a49-29da-457b-bb56-bfa9ce641601" }
{ "gtm.start": 1785486059122, event: "gtm.js" }
{ event: "originalLocation", originalLocation: "https://www.example.com/" }
{ event: "GAVirtual", virtualPageUrl: "/", virtualPageTitle: "…", HK_category: "Ana Sayfa" }
{ event: "gtm.dom" }
{ event: "gtm.load" }
```

## Neden zincir, neden düz script değil

Head'e dört `<script>` yazmak sırayı **garanti etmez**:

- Bir tanesine `async` konduğu anda çalışma sırası ağın döndürme sırasına düşer ve hiçbir yerde hata
  görünmez.
- "Yüklendi", "hazır" demek değildir. Consent aracı hemen çalışır ama kendi konfigürasyonunu
  çektikten sonra kullanılabilir olur; document order bunu bekleyemez.

`sequencedScript` her adımı sırayla kendisi yükler, parser'ı bloklamaz ve bir adımın bir event ile
hazır olduğunu bildirmesini bekleyebilir. Her adımın fail-open bütçesi vardır: cevap vermeyen bir
vendor arkasındaki adımları rehin almamalı — ölçüm sayfadan daha az değerlidir.

## Tracking id neden sunucudan basılmıyor

Doküman **paylaşımlı cache'lenir**. HTML'e gömülen bir tracking id, cache'i dolduran ziyaretçiye ait
olur ve ondan sonraki herkese gider. Bu yüzden 2. adım id'yi **tarayıcıda cookie'den** okur. Aynı
kuralın diğer yüzü `docs/caching.md` → "Cache'lenen şey nedir: yalnız gövde" bölümünde ve
`tests/tracking-id-leak.test.ts` içindedir.

Bu push'ta `event` anahtarı **yoktur**: bu bir olay değil, tag'lerin okuduğu bir değerdir.

## Kuyruk ve fail-open

GTM `gtm.dom`/`gtm.load`'u kendi takvimine göre atar; bu genellikle React mount olmadan öncedir.
`eventQueueScript` bu ikisini tutar ve sayfa görüntüleme düştükten sonra salar.

React hiç gelmezse ne olur? **5 saniye sonra yine salınır.** React'i bekleyip hiç açmamak, ziyareti
tamamen kaybetmek olurdu; sırası bozuk bir ölçüm, hiç olmayan ölçümden iyidir.

## Alan adları sizindir

`configureAnalyticsFields` bir kez `server/product/analytics.ts` içinde çağrılır:

```ts
configureAnalyticsFields({
  trackingIdKey: "hkUserTrackingId",
  fieldPrefix: "HK_",
  pageViewEvent: "GAVirtual",
});
```

`HK_` gibi önekler container'ınızla sizin aranızdaki kontrattır; platforma sızmaz. Sayfa görüntüleme
**düz** basılır (`virtualPageUrl`, `HK_category`, …) çünkü bir tag dataLayer değişkenini adıyla okur;
iç içe bir nesne, her boyut için container arayüzünde ayrı bir değişken tanımı demektir.

## Yapılandırma

| Değişken                    | Ne                                                                           |
| --------------------------- | ---------------------------------------------------------------------------- |
| `GTM_CONTAINER_ID`          | Yoksa zincir consent + tracking id ile biter (development'ta doğru davranış) |
| `CONSENT_SCRIPT_URL`        | Consent aracının adresi; development'ta mock gateway                         |
| `CONSENT_READY_EVENT`       | Aracın hazır olduğunu bildirdiği event (ör. `efilli.consent`)                |
| `ANALYTICS_TRACKING_ID_KEY` | dataLayer'daki anahtar (ör. `hkUserTrackingId`)                              |
| `ANALYTICS_FIELD_PREFIX`    | Boyut öneki (ör. `HK_`)                                                      |

## Sayfa boyutları nereden gelir

Her route bir `pageMeta` üretir:

```ts
pageMeta: (data, ctx) =>
  defaultPageMeta(ctx, "catalog", { category: data.query.category, experiment: data.variant }),
```

`RootLayout` bunu `page-analytics` island'ına verir. Island `defer` ve `eager`'dır: sunucuda hiçbir
şey render etmez, ama chunk'ı hemen indirilir — çünkü gtm.dom onu bekliyor.

Deney kovası (`experiment`) ve kampanya (`campaign`) da boyutlardır. Kolları ayırt edemeyen bir
analiz, analiz değildir — bkz. `docs/middleware.md`.
