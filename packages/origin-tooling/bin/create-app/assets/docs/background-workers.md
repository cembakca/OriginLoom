# Bounded background worker ve bot analytics

`OriginRuntime.onBotVisit`, SSR cevabını bekletmemesi gereken ürün analytics'i için extension
point'tir. Gateway'e request başına fire-and-forget promise göndermek trafik altında sınırsız
socket/promise ve kontrolsüz shutdown üretir.

Worker eklerken queue capacity, concurrency, batch size, flush interval, dedup TTL, sample rate ve
drain timeout ürün config'inde tanımlanıp startup'ta doğrulanmalıdır. Queue doluysa request bloke
edilmez; event drop edilir ve bounded bir `dropped` metriği artırılır. URL, User-Agent, referrer veya
kimlik metric label olmaz.

Hook yalnız küçük, doğrulanmış event'i enqueue eder. Sabit sayıdaki worker batch'i deadline ve
AbortSignal ile gönderir. Retry bounded/backoff'ludur. SIGTERM'de yeni event kabulü kapanır ve
`drain(timeout)` composition root shutdown grubuna girer; instrumentation en son kapanır.

Bu sistem yalnız gerçekten ihtiyacı olan ürüne eklenmelidir. Boş queue altyapısı her starter'a aktif
yük olarak konmaz; yukarıdaki lifecycle değişmeden korunur.
