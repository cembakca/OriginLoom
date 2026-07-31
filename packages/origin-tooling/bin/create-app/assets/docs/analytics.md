# Analytics: dataLayer ve sıra

dataLayer bir çanta değil, **sıralı bir kontrattır**. `gtm.dom`'da çalışan bir tag, o an katmanda ne
varsa onu okur; sayfa görüntüleme ondan sonra gelirse hit boyutsuz gider — ve hiçbir şey hata vermez.
Bu yüzden sıra varsayılmaz, test edilir (`packages/origin-shared` → `analytics-order.test.ts`).

## Sıra

| #   | Ne                                                    | Nerede                                          |
| --- | ----------------------------------------------------- | ----------------------------------------------- |
| 1   | Efilli (`efilli.consent`, `efilli_essential_granted`) | head; **Efilli kendi atar**, zincir beklemez    |
| 2   | `{ userTrackingId }` — **event yok**                  | head, 2. adım (cookie'den, tarayıcıda)          |
| 3   | `gtm.js`                                              | head, 4. adım                                   |
| 4   | `originalLocation`                                    | React, `pushPageView`                           |
| 5   | `GAVirtual` (sayfa görüntüleme)                       | React, `pushPageView`                           |
| 6   | Ürün olayları (promo impression vb.)                  | React, `trackEvent`                             |
| 7   | `gtm.dom`                                             | GTM — **kuyrukta tutulur**, 5'ten sonra salınır |
| 8   | `gtm.load`                                            | GTM — aynı şekilde                              |

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

| Değişken                    | Ne                                                                 |
| --------------------------- | ------------------------------------------------------------------ |
| `EFILLI_SCRIPT_URL`         | Consent aracının adresi. Development'ta mock gateway devreye girer |
| `GTM_CONTAINER_ID`          | Container. Yoksa zincir consent + tracking id ile biter            |
| `ANALYTICS_TRACKING_ID_KEY` | dataLayer'daki anahtar (ör. `hkUserTrackingId`)                    |
| `ANALYTICS_FIELD_PREFIX`    | Boyut öneki (ör. `HK_`)                                            |

Efilli için **tek** değişken vardır: URL. Olay adları Efilli'nindir, bu dosya onları ne adlandırır ne
bekler.

### Neden hiçbir consent olayı beklenmiyor

Bir sürüm boyunca zincir `efilli.consent` push'unu bekledi. Yanlıştı ve şöyle kırılıyordu:

- **Daha önce onay vermiş ziyaretçi:** Efilli kararı zaten biliyor, olayı çalışırken hemen push
  ediyor → zincir anında devam ediyor.
- **Gizli sekme / ilk ziyaret:** Efilli banner gösteriyor. Olay, ziyaretçi cevaplayınca geliyor — on
  saniye sonra, ya da hiç. Zincir takılıyor ve fail-open bütçesi dolana kadar bekliyor.

Sonuç: aynı site normal pencerede bir sıra, gizli sekmede bambaşka bir sıra üretiyordu.

**Script sırası tarayıcının bedavaya verdiği bir garantidir; bir olay ise bir insan hakkında bir
vaattir.** Consent aracı sırayla yüklenir, kendi olaylarını ne zaman atarsa atar, zincirin geri kalanı
onu beklemez. Next.js'teki `beforeInteractive` script sırasıyla aynı model.

### Consent eksikse sessiz kalınmaz

Container, Efilli'nin varlığına **bağlanmaz**. Hangi tag'in çalışacağına karar vermek consent
platformunun işidir. Bir env değişkeni eksik diye GTM'i yüklememek, tek bir yapılandırma hatasını
sıfır ölçüme çevirirdi — bu "trafik yok" gibi okunur ve haftalar sonra fark edilir.

Onun yerine production'da `EFILLI_SCRIPT_URL` yoksa başlangıçta bir kez hata log'lanır.

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
