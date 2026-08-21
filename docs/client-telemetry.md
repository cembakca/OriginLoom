# Client Error Telemetry Güvenlik ve Saklama Politikası

`POST /api/internal/client-errors`, island ve React root hatalarını best-effort olarak server loguna
taşır. Endpoint bir hata izleme ürünü veya sınırsız log ingestion servisi değildir.

**Endpoint platformun parçasıdır.** İstemci tarafı (`reportClientError`,
`@originloom/shared/lib/client/error-telemetry`) bu yolu sabit yazar, bu yüzden sunucu tarafı da
platformda durur: `mountClientErrorApi` — `@originloom/core/api/client-errors`. Üretilen her
uygulama `server/api/index.ts` içinde bunu mount eder; etmezse tarayıcıdaki her istemci hatası
konsolda 404 olur ve sunucuya hiç ulaşmaz. Showroom aynı mount'u kendi rate-limit/sampling
ayarlarıyla sarar (`server/api/internal/client-errors.ts`).

# Client → server correlation

Island and React errors call `reportClientError`, which POSTs to `/api/internal/client-errors`.
The SSR document embeds a `pageRequestId` in the `originloom-request` JSON block; the client
includes it in the telemetry payload so server logs can be joined to the original page request.

Server logs carry:

- `pageRequestId` — the GET/HEAD that rendered the document; production JSON logunda her zaman
  top-level aynı key ile bulunur, korelasyon yoksa `null` olur
- `requestId` — the telemetry POST itself
- `errorId` — stable id for the client error event

Fatal island yükleme, props, mount veya React root hatasında kullanıcıya hata içeriği (exception
message, stack, component stack) gösterilmez; SSR içeriği silinmez. Island root'un yanına ayrı,
erişilebilir bir `role="alert"` status elementi eklenir ve app-owned `formatIslandError` formatter'ının
ürettiği PII-free `<errorId>` referansını gösterir; bu referans support tarafından aynı `errorId` log
alanıyla aranabilir.

Development also prints `[origin] page requestId …` in the browser console once per load.

İstekler şu sırayla işlenir:

```text
16 KiB body + payload şeması doğrulama
  → errorId tabanlı deterministic sampling
  → güvenilir client IP başına limiter
  → process-global son güvenlik limiti
  → server-side redaction
  → structured warning log
```

Geçersiz payload `400`, limiter tarafından reddedilen payload `429 + Retry-After` döner. Sampling
dışında kalan geçerli event `204` döner ve limiter bütçesi tüketmez. Kabul edilen event de client
mount akışını bloklamamak için `204` döner.

Global limiter uygulama process'ini beklenmeyen event fırtınasından koruyan son frendir. IP limiter,
tek bir kaynağın global bütçeyi tüketmesini zorlaştırır. IP kayıtları process memory'sinde bounded
TTL/LRU map içinde tutulur; loga veya metric label'ına yazılmaz. Bu limitler pod-local'dır ve dağıtık
rate limit garantisi vermez.

## Client IP güven sınırı

`TRUST_PROXY=false` iken `X-Forwarded-For` ve `X-Real-IP` tamamen yok sayılır; socket remote address
kullanılır. `TRUST_PROXY=true` tek başına yeterli değildir: socket peer
`TRUSTED_PROXY_CIDRS` içinde olmalı ve client adresi `TRUSTED_PROXY_HOPS` kadar sağdan çözülmelidir.
Bu seçenekler yalnız uygulama doğrudan güvenilir ingress/load balancer arkasındaysa açılmalıdır.
Forwarded chain sağdan, tanımlı hop sayısıyla çözülür; malformed zincir veya güvenilmeyen socket peer
doğrudan socket adresine düşer.

Uygulama limiter'ları DDoS savunması değildir. `/api/internal/client-errors` için asıl kaba request
rate/body limiti ingress, API gateway veya WAF üzerinde; uygulamaya ulaşmadan önce uygulanmalıdır.
Önerilen başlangıç politikası IP başına dakikada 30 request, kısa burst 10 ve 16 KiB body üst sınırıdır.
Gerçek değerler trafik ve hata oranına göre ayarlanmalıdır.

## Veri minimizasyonu ve redaction

Client yalnız `window.location.pathname` gönderir. Server savunma katmanı olarak gelen `path`
değerindeki query ve fragment'i tekrar kaldırır. Query allowlist'i yoktur; varsayılan kontrat bütün
query değerlerini atmaktır.

Validation sonrasında, log yazılmadan hemen önce şu değerler redact edilir:

- `Bearer ...` credential'ları
- JWT biçimindeki üç parçalı token'lar
- E-posta adresleri
- Metin içindeki URL query parametre değerleri

Redaction `message`, `stack`, `componentStack`, `island` ve normalize edilmiş `path` üzerinde uygulanır.
Regex redaction best-effort'tur; secret'ların client error mesajına hiç sokulmaması asıl kontroldür.
Payload'daki ek `releaseId` alanı kabul edilse bile loga taşınmaz. Release kimliği yalnız güvenilir
server `RELEASE_ID` config'inden eklenir.

## Stack saklama ve erişim politikası

Stack ve component stack uygulama stdout'una structured log olarak yazılır; uygulama process'i kendi
başına kalıcı saklama yapmaz. Production log collector aşağıdaki politikayı uygulamalıdır:

- Client stack logları en fazla **14 gün** tutulur.
- Erişim yalnız production on-call/SRE rolü ve gerektiğinde yetkilendirilmiş güvenlik ekibiyle
  sınırlandırılır.
- Log sorguları ve export işlemleri audit edilmelidir.
- Genel geliştirici, müşteri destek aracı veya analytics pipeline'ına ham stack erişimi verilmez.
- Süre dolduğunda index ve arşiv kopyaları silinmelidir.
- Incident/legal-hold istisnası yazılı onay, ayrı erişim kapsamı ve açık bitiş tarihi gerektirir.

Log sağlayıcısı bu retention ve RBAC politikasını enforce etmiyorsa deployment bu dokümandaki
production kontratını karşılamaz.

## Yapılandırma

- `CLIENT_ERROR_SAMPLE_RATE`: Validation sonrası kabul oranı, `0..1`.
- `CLIENT_ERROR_IP_RATE_LIMIT`: Bir IP'nin pencere içindeki event bütçesi.
- `CLIENT_ERROR_WINDOW_MS`: IP ve global fixed-window süresi.
- `CLIENT_ERROR_IP_MAX_ENTRIES`: Bounded IP registry kapasitesi.
- `CLIENT_ERROR_IP_TTL_MS`: Kullanılmayan IP kaydının TTL'i; window'dan kısa olamaz.
- `CLIENT_ERROR_RATE_LIMIT`: Bütün process için son güvenlik freni.

Metric'ler yalnız kapalı outcome değerleri taşır: accepted, invalid, sampled, IP/global rate-limited.
Raw IP, path, error ID, message veya stack metric label'ı değildir.
