---
name: third-party-scripts
description: Dokümana kendi script'ini ekleme — GTM, analytics, consent aracı, gömülü oynatıcı. CSP, nonce ve bot davranışı dahil.
---

# Üçüncü taraf script'leri

Doküman iskeleti platformda (`@originloom/vanilla/server`) ama **içeriği uygulamanın**.
`server/product/renderer.ts` iki yuva verir ve ikisi de istediğin HTML'i render eder:

| Yuva              | Nereye girer                              | Ne alır             |
| ----------------- | ----------------------------------------- | ------------------- |
| `renderHeadStart` | `<head>`in başı, metadata'dan hemen sonra | `seo`, `cspNonce`   |
| `renderHeadEnd`   | `<head>`in sonu, client entry'den önce    | `cspNonce`, `isBot` |

Erken çalışması gereken şey (dataLayer kurulumu, consent, feature flag) `renderHeadEnd`'e;
sayfanın kimliğine ait olan (doğrulama meta'ları, ek `<link>`) `renderHeadStart`'a gider.

## Bir script eklemek

```ts
// server/product/renderer.ts
import { html, raw } from "@originloom/vanilla/html";

renderHeadEnd: ({ cspNonce, isBot }) =>
  isBot
    ? html``
    : html`<script nonce="${cspNonce ?? ""}">
          ${raw(`window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:"app.ready"});`)}
        </script>
        <script nonce="${cspNonce ?? ""}" src="https://cdn.vendor.example/tag.js" async></script>`,
```

`html` interpolasyonu kaçışlar; script **gövdesi** kaçırılmamalı, o yüzden `raw()` ile geçer.
`raw()`a giren her şeyin kaynağından sen sorumlusun — kullanıcı girdisi asla oraya konmaz.

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
   yukarıdaki örnekte bot için `html``` `` dönülüyor.

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
`skills/islands.md`'e bak.

## Kontrol

```bash
CSP_ENFORCE=true pnpm dev     # politikayı lokalde zorla
curl -sI http://127.0.0.1:3010/ | grep -i content-security-policy
```

Tarayıcı konsolunda "Refused to load/execute" görüyorsan cevap ikisinden biridir: host `csp`'de
yok, ya da inline script'te nonce yok.
