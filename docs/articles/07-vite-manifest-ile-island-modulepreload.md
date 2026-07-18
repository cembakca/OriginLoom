# Vite Manifest ile Island Preload: JavaScript Waterfall’ını Kısaltmak

> Island architecture başlangıç JavaScript’ini küçültür; manifest tabanlı `modulepreload` ise gerçekten
> erken çalışması gereken island’ların ağ üzerinde geç keşfedilmesini önler.

Bu optimizasyonun amacı daha az JavaScript indirmek değildir. Amaç, zaten ilk sayfa yükünde çalışacağını
bildiğimiz küçük island chunk’larının indirilmesini daha erken başlatmaktır.

Projede `layout-client` ve `page-analytics` her document’te `eager` çalışır:

```tsx
<Island name="layout-client" mode="defer" eager props={shell} />
<Island name="page-analytics" mode="defer" eager props={pageMeta} />
```

Bu bilgi yalnız DOM’daki `data-eager` attribute’unda kalırsa browser island dosyasını HTML’i alır almaz
keşfedemez. Önce ana client entry indirilir ve çalışır, entry DOM’u tarar, ardından dynamic import
başlatılır. Island chunk’ının kendi static import’ları da ancak bu aşamadan sonra keşfedilebilir.

## Önceki ağ akışı

Preload olmadan kritik yol kabaca şöyledir:

```text
HTML parse
   ↓
entry.client.js indir ve çalıştır
   ↓
[data-eager] island'ı bul
   ↓
layout-client.js / page-analytics.js iste
   ↓
island'ın static import'larını iste
   ↓
React root mount
```

Bu bir network waterfall’dır: sonraki istek, önceki adım tamamlanmadan keşfedilemez. Hızlı bağlantıda
fark küçük olabilir. Yüksek RTT, mobil bağlantı, boş browser cache’i veya uzak CDN’de her yeni discovery
adımı ek bekleme yaratır.

## Yeni ağ akışı

Server production build sırasında üretilen Vite manifestini okuyup HTML `<head>` içine şu tip linkler
yazar:

```html
<link rel="modulepreload" href="/assets/entry.client-BdOJx0nw.js" />
<link rel="modulepreload" href="/assets/layout-client-Dng8Sgyo.js" />
<link rel="modulepreload" href="/assets/session-store-D6ft8D1_.js" />
<link rel="modulepreload" href="/assets/user-info-store-BSUjbmHO.js" />
<link rel="modulepreload" href="/assets/page-analytics-DRv8F85s.js" />
```

Browser HTML head’i parse ederken entry, iki eager island ve onların static bağımlılıklarını paralel
olarak indirmeye başlayabilir:

```text
HTML parse
   ├── entry.client.js
   ├── layout-client.js
   ├── page-analytics.js
   ├── session-store.js
   └── user-info-store.js

entry çalışır → eager root'ları bulur → önceden indirilen modülleri kullanır → mount
```

`modulepreload` modülü çalıştırmaz. Yalnız fetch, parse ve module map hazırlığını erkene çeker.
Island’ın ne zaman mount edileceğine hâlâ client runtime karar verir.

## Ne kazandık?

### Eager island’ların geç keşfedilmesini azalttık

`layout-client`, auth/UI ipuçlarıyla ortak client store’larını başlangıçta hazırlar.
`page-analytics`, page metadata ve analytics lifecycle sinyalini gönderir. Bu iki işin entry
çalıştıktan sonra yeni network round-trip’leri beklemesi artık daha az olasıdır.

Beklenen sonuç:

- SSR HTML ile island’ın interactive olması arasındaki sürenin azalması.
- Analytics bootstrap’ının daha erken tamamlanması.
- Boş cache ve yüksek RTT koşullarında daha kısa module discovery zinciri.
- Shared dependency’lerin iki island tarafından tekrar preload edilmemesi.

Bu değişiklik TTFB’yi, SSR render süresini veya gateway latency’sini doğrudan iyileştirmez. Toplam
JavaScript byte’ını da küçültmez. Kazanç, gerekli byte’ların daha erken keşfedilip paralel
indirilebilmesidir.

### Hash’li dosya adlarını elle yönetmiyoruz

Production dosya adları her build’de değişebilir:

```text
src/islands/layout-client.tsx
             ↓ Vite build
assets/layout-client-Dng8Sgyo.js
```

Server source dosya adını production dosya adıyla eşlemek için
`dist/client/.vite/manifest.json` okur. Vite Backend Integration rehberi, backend’in entry
chunk’ının `css`, `file` ve recursive `imports` alanlarını kullanarak stylesheet, script ve isteğe
bağlı `modulepreload` linkleri üretmesini önerir.

Manifestte kullandığımız alanlar:

- `isEntry`: Ana client entry’yi gösterir.
- `isDynamicEntry`: Dynamic import ile ayrı üretilmiş island entry’sini gösterir.
- `src`: Chunk’ın kaynak dosyasını island adıyla eşler.
- `file`: Hash’li production dosya yoludur.
- `imports`: Chunk’ın static import ettiği diğer manifest kayıtlarıdır.

`imports` grafiği recursive yürünür. `Set` ile hem cycle hem de ortak dependency tekrarları engellenir.

```text
layout-client ─┬─ entry.client
               ├─ session-store
               └─ user-info-store

page-analytics ┬─ entry.client
               ├─ session-store
               └─ user-info-store
```

İki island aynı store’ları kullansa da HTML’de her URL için tek preload linki oluşur.

## Neden bütün island’ları preload etmiyoruz?

Island architecture’ın temel avantajı kullanılmayacak client kodunu ilk yüklemeden uzak tutmaktır.
Footer accordion, mobil menü veya sayfanın altındaki filtre kullanıcı viewport’a yaklaşmadan
gerekmeyebilir.

Hepsini preload etmek:

- Kullanılmayacak chunk’ları indirebilir.
- Kritik CSS, font ve LCP görseliyle bandwidth yarışına girebilir.
- Düşük öncelikli UI kodunu başlangıç maliyetine geri ekleyebilir.
- “Lazy island” kontratını isim olarak koruyup ağ davranışında bozabilir.

Bu nedenle global liste bilinçli olarak yalnız şunları içerir:

```text
layout-client
page-analytics
```

`mobile-menu`, `footer-accordion`, `user-chrome` ve diğer viewport/deferred island’lar manifestte
bulunsa bile global preload listesine eklenmez.

## Route’a özel eager island nasıl eklenir?

Bir route’taki island ilk ekranda bulunuyor ve kullanıcı etkileşimi için hemen hazır olmalıysa route
bunu açıkça ilan edebilir:

```tsx
export default defineRoute({
  path: "/kredi-hesaplama",
  preloadIslands: ["filter-panel"],
  loader,
  Component: CreditCalculatorPage,
});
```

Server `filter-panel` chunk’ını ve recursive static import’larını global listeyle birleştirir. Ortak
dosyalar yine tekilleştirilir.

Bu alan DOM’u analiz ederek otomatik doldurulmaz. Route sahibi, island’ın gerçekten ilk yük için
kritik olduğuna karar vermelidir. Böylece aşağıdaki iki kavram birbirine karışmaz:

- `<Island eager>`: Client runtime island’ı hemen mount etmeye çalışır.
- `route.preloadIslands`: Server browser’a island modülünü HTML parse sırasında indirmeye başlamasını
  söyler.

İlk ekranda eager çalışan route island’ı için genellikle ikisi birlikte kullanılmalıdır. Yalnız
`preloadIslands` vermek modülü çalıştırmaz; yalnız network hazırlığını erkene alır.

## Development neden farklı?

Development ortamında production manifesti kullanılmaz. Hono document’i doğrudan Vite dev server’daki
source entry’ye bağlanır:

```text
http://127.0.0.1:5174/src/entry.client.tsx
```

HMR ve React Fast Refresh akışını değiştirmemek için manifest tabanlı island preload yalnız production
build’de üretilir. Bu yüzden optimizasyonu doğrularken `npm run build` sonrası production/smoke
response’u incelenmelidir.

## Nasıl ölçülmeli?

“Preload ekledik, kesin hızlandı” demek yeterli değildir. Chrome DevTools Network panelinde Disable
cache ve ağ throttling ile önce/sonra karşılaştırılmalıdır.

Bakılacak sinyaller:

1. `layout-client` ve `page-analytics` request’leri entry çalışmadan önce başlıyor mu?
2. Network initiator preload linkini gösteriyor mu?
3. Aynı shared chunk iki kez indiriliyor mu?
4. LCP görseli veya kritik CSS gecikiyor mu?
5. SSR response ile eager island commit’i arasındaki süre azalıyor mu?
6. Route’a özel preload edilmeyen deferred island viewport dışındayken hâlâ indirilmiyor mu?

Gerçek kullanıcı ölçümünde yalnız `load` süresine bakmak yerine island commit telemetry’si,
Interaction to Next Paint ve analytics ready zamanı izlenmelidir. Preload’un anlamlı olup olmadığı
cihaz, RTT, CDN cache ve chunk boyutuna bağlıdır.

## Bu optimizasyonun sınırları

Bu çalışma:

- SSR’ı streaming’e dönüştürmez.
- Dynamic import ve island code splitting’i kaldırmaz.
- Bütün island’ları eager yapmaz.
- 103 Early Hints göndermez.
- JavaScript bundle boyutunu otomatik küçültmez.
- Yavaş API veya gateway çağrısını hızlandırmaz.

103 Early Hints daha da erken discovery sağlayabilir; fakat ingress/CDN desteği, ara cache davranışı ve
ölçüm gerektirir. Mevcut adım yalnız final HTML içindeki standart `modulepreload` linklerini kullanır.

## Sonuç

Island architecture “hangi JavaScript hiç veya daha sonra yüklensin?” sorusunu çözer.
Manifest tabanlı preload ise “ilk yükte kesin gerekecek JavaScript browser tarafından ne kadar erken
keşfedilsin?” sorusunu çözer.

Kazancımız bütün sayfayı daha fazla JavaScript ile doldurmak değil; yalnız kritik iki island’ın network
waterfall’ını kısaltırken deferred island’ların lazy davranışını korumaktır.

Route'a özgü canlı piyasa island'ı bu ayrım için iyi bir örnektir. `market-live` production manifestte
ayrı dynamic entry olarak bulunur; global preload listesine eklenmez. BIST route'u ilk ekranda daha
erken interactivity isterse `preloadIslands: ["market-live"]` diyebilir, fakat bu karar diğer bütün
sayfalara market stream kodu yükletmez. Preload ile çalıştırma yine ayrı kontratlardır.

---

## Kaynaklar

- [Vite Backend Integration](https://vite.dev/guide/backend-integration)
- [Vite Manifest](https://vite.dev/guide/backend-integration#manifest)
- [MDN `rel="modulepreload"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload)
- [Island Architecture ile Cache-Safe Kişiselleştirme ve Auth](./04-island-architecture-ile-cache-safe-kisisellestirme-ve-auth.md)
