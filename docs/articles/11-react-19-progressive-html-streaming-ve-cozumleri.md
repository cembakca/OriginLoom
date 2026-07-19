# React 19 ile Progressive HTML Streaming: Kontratlar ve Sınırlar

Progressive SSR, tüm loader verisini beklemeden shell’i ve hazır Suspense sınırlarını browser’a
gönderebilir. Fakat bu yalnız `renderToPipeableStream()` çağırma işi değildir. Status code, cache,
Content Security Policy, bot çıktısı, client disconnect ve hydration discovery aynı anda çözülmelidir.

Bu projede streaming opt-in bir route özelliğidir. Normal route’ların buffered SSR davranışı değişmez.

## Buffered SSR ile streaming arasındaki gerçek fark

```text
Buffered
loader → tüm React render → tam HTML string → status/header/body

Streaming
loader shell verisi → onShellReady → response başlar
                         └─ Suspense içerikleri hazır oldukça akar
```

Streaming, yavaş dependency’nin işini hızlandırmaz. Yalnız kullanıcıya gösterilebilir shell ile bütün
verinin hazır olduğu an arasındaki beklemeyi böler. Bu nedenle fayda TTFB kadar fallback kalitesi,
Suspense sınırlarının yeri ve gerçek proxy davranışına bağlıdır.

## Route kontratı

Bir route `streaming: true` diyerek bu davranışı açıkça seçer:

```tsx
export default defineRoute<CreditCardStreamingData>({
  path: "/kredi-kartlari/:slug",
  streaming: true,
  cache: () => neverCache(),
  loader: async (ctx) => {
    const detail = await getCreditCard(ctx.params.slug, ctx.request.signal);
    if (!detail) return notFound();
    return {
      data: {
        detail,
        campaignsPromise: getCreditCardCampaigns(ctx.params.slug, ctx.request.signal).then(
          (result) => result?.campaigns ?? [],
        ),
      },
    };
  },
  Component: CreditCardDetailPage,
});
```

Component React 19 `use()` ile promise’i Suspense sınırında çözer:

```tsx
function CampaignList({ campaignsPromise }: Props) {
  const campaigns = use(campaignsPromise);
  return campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />);
}

<CreditCardSummary detail={detail} />
<ApplicationCallToAction product={detail.product} />
<Suspense fallback={<CampaignListSkeleton />}>
  <CampaignList campaignsPromise={campaignsPromise} />
</Suspense>;
```

Burada ilk HTML kart özeti ve banka başvuru CTA'sını taşır; kampanya servisi bu kritik alanları
geciktirmez. Route bilinçli olarak `neverCache()` kullanır; böylece insan GET isteği gerçekten
progressive response alır. Ürün listeleri ve Bilgi Merkezi document cache kullanmaya devam eder.

Cacheable streaming route’ta uygulama cold fill sırasında kullanıcıya yarım stream vermez:
render `cache_fill` fazında `allReady` sonuna kadar buffer edilir, sonra atomik body olarak Redis’e
yazılır. Dolayısıyla cache MISS yolu ile gerçek progressive BYPASS yolu aynı latency davranışına sahip
değildir.

## 1. Header gönderildikten sonra status değişmez

`onShellReady` sonrasında response başlamışsa sonradan oluşan render hatasını HTTP `500` yapmak mümkün
değildir. Uygulama iki hata evresini ayırır:

- `onShellError`: Shell başlamadan hata; route error document’i ve `500` üretilebilir.
- `onError`: Shell başladıktan sonra hata; loglanır, React’in client recovery mekanizmasına bırakılır.

Bu yüzden kritik authorization, redirect, not-found ve domain validation kararları Suspense içindeki
geç bir render’a bırakılmamalı; loader aşamasında çözülmelidir.

“Her async widget hata izolasyonuna sahiptir” de otomatik doğru değildir. Beklenen widget hatası için
component/error boundary veya loader sonucu tasarlanmadıysa stream yine bozulabilir. Suspense loading
sınırıdır; tek başına error boundary değildir.

## 2. Redis'e yarım HTML yazmamak

Bir stream chunk’ını geldikçe shared cache’e append etmek tehlikelidir. Process ölürse skeleton,
tamamlanmamış tag veya React runtime’ın yarısı kalabilir. Uygulama cache fill ve SWR fazında:

1. React stream’i başlatır.
2. `allReady` tamamlanmasını bekler.
3. Stream’i tam string’e çevirir.
4. Yalnız başarılı ve cacheable sonucu tek entry olarak yazar.

Canlı BYPASS response ise Redis’e yazılmaz. Bu, “dual writer ile aynı anda hem browser’a hem Redis’e
stream ediyoruz” anlamına gelmez; iki render fazının kontratı ayrıdır.

## 3. Client disconnect bütün işi kesmeli

Request `AbortSignal`, loader’ın gateway fetch’lerine taşınır. Browser bağlantıyı kapatırsa React
stream `.abort()` ile durdurulur. Aksi durumda artık kimsenin okumadığı HTML için React render ve
upstream I/O devam eder.

Abort listener’larının kendisi de lifecycle kaynağıdır. Uzun yaşayan global emitter’a sınırsız listener
eklenmemeli; stream bittiğinde veya request kapandığında cleanup doğrulanmalıdır.

## 4. Proxy buffering uygulama koduyla tamamen çözülemez

Streaming HTML response `no-transform, no-cache, no-store, must-revalidate` taşır. Bu, ara katmanlara
body’nin dönüştürülmemesi gerektiğini söyler ve shared cache riskini kapatır. Fakat yalnız
`Cache-Control: no-transform` her CDN veya reverse proxy’nin buffering yapmayacağını garanti etmez.

Production doğrulamasında bütün zincir test edilmelidir:

```text
Node/Hono → service mesh → ingress → CDN/WAF → browser
```

Nginx benzeri katmanlarda buffering’in kapatılması gerekebilir. HTTP/2 kullanmak da tek başına
uygulama/proxy buffer’ını ortadan kaldırmaz. İlk chunk’ın gerçekten erken ulaştığı `curl --no-buffer`
ve browser timing ile ölçülmelidir.

SSE endpoint’i ayrıca `X-Accel-Buffering: no` gönderir; bu header’ı HTML streaming route’larının da
gönderdiğini varsaymıyoruz. İki streaming türünün response kontratları ayrıdır.

## 5. Botlar için conditional buffering

Bot tespiti `server/handler.ts` içinde değil, SSR execution katmanında uygulanır. `isBotRequest()`
sonucu true ise `shouldStream` false olur; route yine React stream renderer kullanabilse de server
`allReady` sonuna kadar bekleyip tam HTML string üretir.

```text
human + streaming route + request phase → progressive Response body
bot   + streaming route                 → allReady → buffered full HTML
cache fill / revalidation               → allReady → buffered full HTML
```

Bu yaklaşım crawler’a final content vermeyi kolaylaştırır, fakat “SEO hiçbir şekilde risk taşımaz”
garantisi vermez. User-Agent spoof edilebilir; bot listesi eskir; canonical, robots, status, crawlable
anchor ve embedded JSON escaping ayrı SEO kontratlarıdır. Bot buffering bunların yerine geçmez.

## Streaming ile CSP

React Suspense boundary’lerini açmak için dinamik inline script üretebilir. Script text’i her response
için sabit kabul edilip hash’lenemez. Security middleware’in ürettiği request nonce’u hem CSP header’a
hem `renderToPipeableStream({ nonce })` seçeneğine verilir.

Cache fill buffered olduğu ve request nonce’unu shared body identity’sine dönüştürmediği için nonce
yeniden kullanım riski oluşmaz. Bu invariant streaming/caching kodu değiştirilirken birlikte test
edilmelidir.

## Sonradan gelen island'ları hydrate etmek

Client bootstrap ilk DOM taramasında yalnız skeleton’ı görebilir. Gerçek island markup’ı React stream
chunk’ıyla sonra eklenirse ilk tarama onu kaçırır. `MutationObserver` eklenen node’larda
`[data-island]` arar ve aynı bounded mount scheduler’a yollar.

Observer document parse tamamlandığında disconnect olur. Buradaki varsayım React’in stream
insertion’larının `DOMContentLoaded` öncesinde gerçekleşmesidir. Bu davranış browser/proxy testinde
korunmalıdır; gelecekte stream insertion daha geç sürebilecekse observer lifecycle’ı “bitti” sinyaline
bağlanmalıdır.

`IntersectionObserver` yoksa client runtime fail-open biçimde island’ları doğrudan mount eder. Chunk
load ve recoverable hydration hataları client telemetry’ye gider; kritik eager island’ların başarısı
bootstrap testleriyle korunur.

## Ne zaman streaming kullanmamalıyız?

- Bütün içerik tek hızlı gateway çağrısıyla geliyorsa.
- Route full-document cache’ten çoğunlukla HIT dönüyorsa.
- Skeleton ile final layout arasında büyük shift varsa.
- Status/redirect kararı geç async render’a bağlıysa.
- Ingress/CDN zinciri response’u buffer ediyorsa.
- Operasyon ekibi partial response ve post-shell error’ı gözlemleyemiyorsa.

Streaming tüm route’lara açılan global switch değildir. Yalnız kullanıcıya erken ve anlamlı shell
verebilen route’larda kullanılır.

## Ölçülmesi gerekenler

- Shell TTFB ve `allReady` süresi ayrı ayrı.
- İlk anlamlı içerik ve LCP; yalnız ilk byte değil.
- Post-shell render error oranı.
- Client abort sonrası loader/render’ın gerçekten kesilme süresi.
- Proxy arkasında ilk ve son chunk zamanı.
- Bot response’unun final içerik ve status bütünlüğü.
- Streaming route’un cache state dağılımı.
- Hydration recovery ve geç keşfedilen island sayısı.

“Shell 20–50 ms’de görünür” gibi sabit bir garanti vermiyoruz. Bu değer gateway, shell loader,
container CPU, network RTT ve proxy zincirine bağlıdır; production RUM ve server histogramlarıyla
ölçülmelidir.

## Next.js ile karşılaştırma

Next.js App Router Suspense ve `loading.tsx` ile streaming’i framework içinde sunar; self-hosting
rehberi proxy buffering’in kapatılması gerektiğini ayrıca belirtir. Bu projede kazanç “Next.js streaming
yapamıyor” değildir. Fark, bot buffering, cache-fill atomikliği, route cache state’i ve CSP nonce
taşımasının kendi execution kontratımızda görünür olmasıdır.

Bu görünürlük beraberinde bakım borcu getirir. React streaming callback semantiği, ingress davranışı,
client observer ve hata telemetry’si artık bizim sorumluluğumuzdur.

## Sonuç

Progressive HTML streaming doğru yerde kullanıldığında yavaş widget’ın bütün shell’i bekletmesini
engeller. Production doğruluğu ise şu sınırlarla gelir:

- Loader terminal kararları stream başlamadan verir.
- Cache entry yalnız tamamlanmış body’den oluşur.
- Bot ve cache-fill yolları `allReady` sonuna kadar buffer edilir.
- Request abort React ve gateway I/O’yu keser.
- CSP nonce React runtime script’lerine taşınır.
- Proxy zinciri gerçek chunk timing ile doğrulanır.
- Geç gelen island’lar kontrollü biçimde hydrate edilir.

Streaming bir render flag’inden çok response lifecycle kontratıdır.

---

## Kaynaklar

- [React `renderToPipeableStream`](https://react.dev/reference/react-dom/server/renderToPipeableStream)
- [React `Suspense`](https://react.dev/reference/react/Suspense)
- [Next.js Streaming](https://nextjs.org/learn/dashboard-app/streaming)
- [Next.js Self-hosting — Streaming and Suspense](https://nextjs.org/docs/app/guides/self-hosting#streaming-and-suspense)
- [MDN `MutationObserver`](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
- [Hono Streaming Helper](https://hono.dev/docs/helpers/streaming)
- [Hono Request Context yazısı](./02-reacti-framework-olmadan-ssr-etmek-hono-uzerinde-request-pipeline.md)
