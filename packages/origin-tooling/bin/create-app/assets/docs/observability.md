# Observability ve runtime lifecycle

Platform request, cache, gateway, render admission ve client error metriklerini üretir. Uygulama
`OriginRuntime.metricSources` ile yalnız kendi bounded-cardinality metriklerini ekler. Slug, URL,
query, kullanıcı veya request id metric label olamaz; kapalı enum ya da bucket kullanın.

`server/index.ts` tracing'i requestlerden önce başlatır. Shutdown sırası: public listener ve stream
admission'ını kapat, açık streamleri sonlandır, revalidation ve ürün worker'larını drain et, cache'i
kapat, son span'leri export et. Queue tabanlı analytics eklenirse capacity, concurrency, batch,
sampling ve drain timeout startup'ta doğrulanmalıdır; queue overflow ölçülmeli ve request'i bloke
etmemelidir.

Browser runtime hataları `/api/client-errors` üzerinden server loguna taşınır. Endpoint public input
olduğu için platform sampling, body limit ve rate limit uygular. Secret, token, tam URL veya kişisel
payload hata metadata'sına eklenmemelidir.

Operations listener `/metrics`, readiness ve purge içindir. Kubernetes network policy/Service ile
yalnız monitoring ve operations ağlarına açın; public ingress'e bağlamayın.

## SSR teşhis modu

Metrikler bir sayfanın yavaş ya da hatalı olduğunu söyler; hangi upstream çağrının sebep olduğunu
söylemez. `SSR_DIAGNOSTICS=1` bunu açar: servislerin kullandığı `@server/diagnostics/gateway`
adaptörü her gateway çağrısını süresi, metodu ve durumuyla kaydeder, istek kapanırken **yalnız**
başarısız ya da yavaş istekler için tek bir log satırına dökülür. Eşik `SSR_DIAGNOSTICS_SLOW_MS`
(varsayılan 750 ms).

Kapalıyken kayıt yolu hiç çalışmaz — üretimde açana kadar maliyeti yoktur. Bir olayı incelerken
açın, sonra kapatın: her istek için bellekte bir kayıt tutar ve log hacmini artırır.

## 503 / render admission

503 yanıtları çoğu zaman **bilinçli kapasite korumasıdır** — pod çökmek yerine istek shed edilir.
Load test stress fazlarında yüksek 503 oranı beklenen sinyaldir; steady-state prod trafiğinde
sıfıra yakın olmalıdır (`docs/load-testing.md`).

İlk bakılacak metrikler:

| Metrik                                | Ne söyler                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `ssr_render_rejections_total{reason}` | Shed edilen SSR istekleri (`queue_full`, `wait_timeout`, `request_aborted`) |
| `ssr_render_in_flight`                | Aktif render slot kullanımı                                                 |
| `ssr_render_queue_depth`              | Kuyrukta bekleyen istek sayısı                                              |

Reason → aksiyon:

| `reason`          | Olası neden                                                                | İlk adım                                                                                           |
| ----------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `queue_full`      | Concurrency + queue dolu; çoğunlukla `cache=BYPASS` rotalar slot tüketiyor | `SSR_MAX_CONCURRENCY` / `SSR_MAX_QUEUE` artır; cache HIT oranını ve BYPASS route payını kontrol et |
| `wait_timeout`    | Render veya gateway yavaş; kuyruk bekleme bütçesi bitti                    | Gateway/loader süresi, `SSR_QUEUE_WAIT_MS`, `SSR_REQUEST_TIMEOUT_MS`                               |
| `request_aborted` | Client veya LB isteği erken kesti                                          | Ingress/LB timeout ile SSR bütçelerini hizala                                                      |

503 yanıtları `Retry-After` ve `x-ssr-rejection` header'ları taşır; LB retry politikası buna göre
ayarlanabilir.
