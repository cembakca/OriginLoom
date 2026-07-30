# Progressive HTML ve Server-Sent Events

Route'taki `streaming: true`, React Suspense shell'ini önce gönderir. Header gönderildikten sonra HTTP
status değişemeyeceği için kritik loader kararlarını stream başlamadan verin. Streaming HTML shared
cache'e yazılmaz; botların tamamlanmış document ihtiyacını ürün politikasında ayrıca değerlendirin.

## Gerçek upstream ile progressive HTML

`/live` örneği route içinde yapay bir timer çalıştırmaz. Loader
`server/services/live-message.ts` üzerinden gateway'deki `/live/message` isteğini başlatır ve bu
non-critical Promise'i **await etmeden** route data'sına koyar. React kullanılabilir shell'i ve
Suspense fallback'ini hemen stream eder; service cevabı boyut ve runtime schema kontrolünden geçince
aynı response'un sonraki chunk'ı tamamlanır.

```ts
loader: async (ctx) => ({
  data: {
    slowMessage: getLiveMessage(ctx.request.signal),
  },
});
```

Local mock gateway bu endpoint'i varsayılan olarak 600 ms geciktirir; bu süre framework overhead'i
değil, gözle görülebilir bir upstream latency fixture'ıdır. Yalnız bu örneğin gecikmesini değiştirmek
için mock process'e `MOCK_LIVE_MESSAGE_DELAY_MS` verin. `MOCK_GATEWAY_DELAY_MS` ise bütün gateway
endpoint'lerine ek gecikme uygular. Production'da mock ve 600 ms sabiti yoktur; süre gerçek upstream
işinin latency'sidir.

Deferred veri kritik redirect/not-found/status kararını etkiliyorsa bu pattern'i kullanmayın: service'i
loader'da await edin ve stream başlamadan terminal kararı verin. Deferred Promise reddedebiliyorsa
sayfada ürüne uygun bir error boundary/fallback sağlayın.

`/api/ticks` production-safe SSE iskeletidir:

- `Accept: text/event-stream`, same-origin ve `Sec-Fetch-Site` doğrulaması,
- process ve IP başına aktif bağlantı admission'ı,
- heartbeat, maksimum connection süresi ve reconnect bildirimi,
- abort/shutdown temizliği ve idempotent lease release,
- `private, no-store, no-transform`, `X-Accel-Buffering: no`,
- bounded-label Prometheus metrikleri.

Gerçek upstream akışında her browser için ayrı gateway socket açmayın. Symbol/topic bazlı ortak bir
hub kurun. Slow consumer kuyruğunu sınırsız büyütmeyin; snapshot türü veride latest-value coalescing
kullanın. Event payload'ı da gateway JSON'u gibi untrusted input'tur ve boyut/şema sınırından geçer.
