---
name: third-party-scripts
description: Dokümana kendi script'ini ekleme — GTM, analytics, consent aracı, gömülü oynatıcı. CSP, nonce ve bot davranışı dahil.
---

# Üçüncü taraf script'leri

Doküman iskeleti platformda (`@originloom/react/server`) ama **içeriği uygulamanın**.
`server/product/renderer.tsx` iki yuva verir ve ikisi de istediğin JSX'i render eder:

| Yuva              | Nereye girer                              | Ne alır             |
| ----------------- | ----------------------------------------- | ------------------- |
| `renderHeadStart` | `<head>`in başı, metadata'dan hemen sonra | `seo`, `cspNonce`   |
| `renderHeadEnd`   | `<head>`in sonu, client entry'den önce    | `cspNonce`, `isBot` |

Erken çalışması gereken şey (dataLayer kurulumu, consent, feature flag) `renderHeadEnd`'e;
sayfanın kimliğine ait olan (doğrulama meta'ları, ek `<link>`) `renderHeadStart`'a gider.

## Bir script eklemek

```tsx
// server/product/renderer.tsx
renderHeadEnd: ({ cspNonce, isBot }) => (
  <>
    <script
      nonce={cspNonce}
      dangerouslySetInnerHTML={{
        __html: `window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:"app.ready"});`,
      }}
    />
    <script nonce={cspNonce} src="https://cdn.vendor.example/tag.js" async />
  </>
),
```

Üç kural:

1. **`nonce={cspNonce}` her inline script'te.** Production'da CSP her istekte bir nonce üretir ve
   `script-src`'ye koyar; nonce'suz inline script çalışmaz. Development'ta `cspNonce` `undefined`
   olur ve React attribute'u hiç yazmaz — orada `'unsafe-inline'` geçerlidir, çünkü Vite HMR'ın
   ihtiyacı var. Yani lokalde çalışıp production'da sessizce ölen bir script yazmak mümkündür;
   `CSP_ENFORCE=true` ile lokalde de zorlayıp önceden görebilirsin.

2. **Dış host'u `csp` ile bildir.** Platform hiçbir satıcıyı tanımaz:

   ```ts
   // server/index.ts
   createApp({
     csp: {
       scriptSrc: ["https://cdn.vendor.example"],
       connectSrc: ["https://collect.vendor.example"],
       imgSrc: ["https://pixels.vendor.example"],
     },
     …
   });
   ```

   Kaynaklar eklemelidir; platformun kendi ihtiyaçları (`'self'`, asset CDN'i, dev sunucusu) zaten
   içeridedir. Bildirmezsen tarayıcı script'i indirmez ve konsolda "Refused to load" görürsün.

3. **`isBot`'a bak.** Crawler'a analytics yüklemek hem ölçümü kirletir hem tarama bütçesi harcar:
   `isBot ? null : <script … />`.

## Sıra

Analytics ekipleri sık sık "önce şu, o bitince şu" ister. İyi haber: **klasik script'ler
`<head>`e yazdığın sırayla çalışır ve her biri bitmeden sonraki başlamaz.** Bu bir HTML garantisi.
Sırayla yaz, `async` verme, bitti:

```tsx
renderHeadEnd: ({ cspNonce }) => (
  <>
    <script nonce={cspNonce} src="https://cdn.vendor.example/consent.js" />
    <script nonce={cspNonce} dangerouslySetInnerHTML={{ __html: dataLayerBootstrap }} />
    <script nonce={cspNonce} src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX" />
  </>
),
```

Bunu iki şey bozar ve `sequencedScript` tam olarak bunlar için var:

- **`async`**: çalışma sırasını "ağdan ilk dönen" belirler. Tek bir `async` bütün sırayı sessizce
  bozar, hiçbir yerde hata çıkmaz.
- **"Bitmek" her zaman "çalışmak" değildir.** Bir consent aracı ya da tag manager hemen çalışıp
  ancak kendi konfigürasyonunu çektikten sonra kullanılabilir hâle gelebilir. Doküman sırası bunu
  bekleyemez — `<script>` çalıştı, ama araç henüz hazır değil.

Ayrıca yukarıdaki blok **parser'ı bloklar**: her satıcı script'i indirilene kadar sayfa bekler.

```tsx
import { sequencedScript } from "@originloom/shared/head-scripts";

const analyticsSequence = sequencedScript(
  [
    // 1) Satıcı script'i — çalışması yetmez, hazır olduğunu bildirmesini bekle.
    { src: "https://cdn.vendor.example/consent.js", awaitEvent: "consent:ready" },
    // 2) Ancak consent kararı belliyken dataLayer'ı kur.
    { code: `window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:"app.ready"});` },
    // 3) Tag manager, dataLayer hazırken.
    { src: "https://www.googletagmanager.com/gtm.js?id=GTM-XXXX" },
    // 4) Kendi ölçüm isteğin, en sonda.
    { code: `navigator.sendBeacon("/api/collect")` },
  ],
  { timeoutMs: 4_000 },
);

renderHeadEnd: ({ cspNonce, isBot }) =>
  isBot ? null : <script nonce={cspNonce} dangerouslySetInnerHTML={{ __html: analyticsSequence }} />,
```

Ne yapar:

- Adımları **sırayla** yükler, ama parser'ı bloklamaz (kendisi enjekte eder, `async=false` ile).
- Dış adım `load` olunca biter; `awaitEvent` verilmişse o olay `window`da tetiklenene kadar
  sonraki adım başlamaz.
- Inline adım eklendiği anda çalışır ve hemen biter.
- **Her adımın açılma bütçesi vardır.** Yüklenemeyen ya da hazır sinyali hiç gelmeyen bir satıcı
  arkasındaki adımları kilitlemez: süre dolunca zincir devam eder. Ölçüm sayfadan daha değerli
  değildir; siteyi bekleten analytics, analytics'in hatasıdır.
- Kendi nonce'unu `document.currentScript.nonce` üzerinden okuyup enjekte ettiği her script'e
  koyar, böylece zincirin tamamı nonce tabanlı CSP'den geçer.

Sınırlar, peşinen: satıcının hazır olduğunu **bir olayla** bildirmesi gerekir. Callback'li API'ler
için araya kendi inline adımını koyup olayı sen tetikle:

```ts
{ code: `window.vendor.onReady(function(){ dispatchEvent(new Event("vendor:ready")) })` },
```

`awaitEvent` dinlenmeye başlamadan **önce** tetiklenen bir olay kaçırılır ve o adım süre dolunca
geçilir — satıcı senkron hazır oluyorsa `awaitEvent` kullanma, gerek yok.

## Nonce taşıyamayan script'ler

Bir satıcı script'i sayfaya kendi inline script'ini enjekte ediyorsa (GTM'in yaptığı budur) o
script nonce taşımaz. Bu durumda hash kaydedilir:

```ts
import { registerCspScriptHashes } from "@originloom/core/middleware/security";

registerCspScriptHashes("'sha256-…'"); // startup'ta, createApp'ten önce
```

Hash'ler yalnızca production'da devreye girer — development `'unsafe-inline'` ile çalışmaya devam
eder, çünkü hash varlığı tarayıcıya `'unsafe-inline'`ı yok saydırır ve HMR kırılırdı.

## Paylaşılan cache ile ilişkisi

`renderHeadEnd` çıktısı **dokümanın parçasıdır**, yani paylaşılan HTML cache'ine girer. Kullanıcıya
özel hiçbir değer (isim, segment, oturum kimliği) buraya yazılmamalıdır — yoksa bir kullanıcının
verisi başkasına servis edilir. Kişiselleştirme island'dan `/api/session` çağırarak yapılır;
`skills/islands.md` ve `server/api/session.ts` örneğine bak.

## Kontrol

```bash
CSP_ENFORCE=true pnpm dev     # politikayı lokalde zorla
curl -sI http://127.0.0.1:3010/ | grep -i content-security-policy
```

Tarayıcı konsolunda "Refused to load/execute" görüyorsan cevap ikisinden biridir: host `csp`'de
yok, ya da inline script'te nonce yok.
