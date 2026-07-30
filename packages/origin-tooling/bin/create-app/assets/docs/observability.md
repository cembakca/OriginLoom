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
