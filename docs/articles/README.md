# Next.js’ten Explicit SSR’a — Makale Serisi

Bu seri, Next.js App Router’dan Hono + React tabanlı explicit SSR runtime’a geçişin nedenlerini,
yeniden inşa edilen platform parçalarını ve production sınırlarını anlatır. Yazılar “Next.js yapamaz”
iddiası taşımaz; framework convention’ları yerine route, cache ve request lifecycle kontratlarını açık
olarak sahiplenmenin kazanç ve maliyetlerini inceler.

## Ana okuma yolu

1. [Dynamic Rendering Bizi Neden Next.js’ten Uzaklaştırdı?](./01-dynamic-rendering-bizi-neden-nextjsten-uzaklastirdi.md)
2. [React’i Framework Olmadan SSR Etmek: Hono Üzerinde Request Pipeline](./02-reacti-framework-olmadan-ssr-etmek-hono-uzerinde-request-pipeline.md)
3. [Cache Bir Optimizasyon Değil, Route Kontratıdır](./03-cache-bir-optimizasyon-degil-route-kontratidir.md)
4. [Island Architecture ile Cache-Safe Kişiselleştirme ve Auth](./04-island-architecture-ile-cache-safe-kisisellestirme-ve-auth.md)
5. [Gerçek Gateway Olmadan Gerçekçi Bir SSR Sistemi Geliştirmek](./05-gercek-gateway-olmadan-gercekci-bir-ssr-sistemi-gelistirmek.md)

## Ölçüm ve platform derinlik yazıları

6. [Aynı Sayfada Next.js ve OriginLoom: Yük Testi](./06-ayni-sayfada-nextjs-ve-origin-loom-yuk-testi.md) — belirli bir kurulumun tarihsel benchmark snapshot’ı.
7. [Vite Manifest ile Island Preload](./07-vite-manifest-ile-island-modulepreload.md) — eager JavaScript discovery ve network waterfall.
8. [Redis HTML Cache’i İçin HTML-Odaklı Brotli](./08-redis-html-cache-icin-html-odakli-brotli-sikistirma.md) — binary wire format ve storage/CPU dengesi.
9. [Cache-Safe CSP ve Observability](./09-hono-ssr-uzerinde-cache-safe-csp-ve-observability.md) — hash, nonce, telemetry cardinality ve long-lived stream metrikleri.
10. [Islands ve Progressive Hydration](./10-islands-mimarisinde-bundle-size-optimizasyonu-ve-progressive-hydration.md) — bundle graph, provider ownership ve ölçüm disiplini.
11. [React 19 Progressive HTML Streaming](./11-react-19-progressive-html-streaming-ve-cozumleri.md) — status, cache-fill, bot, CSP ve proxy sınırları.
12. [Dinamik Fragment Cache ve Buffered HTML Stitching](./12-dynamic-fragment-caching-ve-html-stitching-mimarisi.md) — page body içindeki bağımsız public HTML kontratları.
13. [SSR Snapshot’tan Canlı Fiyata](./13-ssr-snapshot-ile-guvenli-canli-piyasa-verisi.md) — güvenli SSE BFF, fan-out, backpressure ve degrade davranışı.
14. [SSR’dan Hydration’a Server-Otoriteli Finans Araçları](./14-ssrdan-hydrationa-server-otoriteli-finans-araclari.md) — kredi hesaplama, no-JS form, BFF iş kuralı ve bounded karşılaştırma URL'leri.

## Konuya göre kısa yollar

- Cache ve Redis kapasitesi: 3, 8 ve 12.
- Auth, hydration ve BFF: 4, 5 ve 14.
- Client JavaScript performansı: 7 ve 10.
- React streaming: 2, 9 ve 11.
- Canlı finans verisi: 3, 4, 9 ve 13.
- Production operasyonu: 5, 9, 11 ve 13.

## Okuma notu

Kod yaşayan bir sistemdir. Sayısal benchmark ve bundle değerleri ölçüm tarihiyle birlikte okunmalı;
route/cache/güvenlik kontratları ise güncel kaynak kod ve `ARCHITECTURE.md` ile doğrulanmalıdır. Mock
gateway bilinçli bir development dependency’sidir; gerçek provider’ın SLA, IAM, lisans veya veri
doğruluğunu temsil etmez.
