# Cache ve fragment rehberi

Bu projede dört ayrı cache katmanı vardır. Aynı problemi çözmezler:

| Katman                  | Örnek                              | Nerede çalışır?                                | Ne zaman kullanılır?                                          |
| ----------------------- | ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| HTML/document cache     | `/`, `/catalog`, `/items/:slug`    | SSR sunucusu; L1 memory, isteğe bağlı L2 Redis | Aynı public HTML'i birçok ziyaretçi paylaşabiliyorsa          |
| Data/read-through cache | `/data-cache`, menu servisi        | SSR sunucusu; document cache ile aynı store    | Bir endpoint sonucu birçok request'te yeniden kullanılıyorsa  |
| Fragment cache          | `/showcase` içindeki header/footer | SSR sunucusu                                   | Uzun ömürlü document içindeki bir bölüm farklı TTL istiyorsa  |
| Client query cache      | account island'ındaki React Query  | Tarayıcı                                       | Kullanıcıya özel veya etkileşimle yenilenen istemci verisinde |

Kullanıcı, session, access token ve refresh token verisi ilk üç shared cache katmanına hiçbir zaman
yazılmaz. Kişisel bir sayfanın tamamında `never`; public bir sayfadaki kişisel blokta `defer` island
ve React Query kullanın.

## Template'teki çalışan örnekler

| Route/dosya               | Strateji                                 | Neyi gösterir?                                     |
| ------------------------- | ---------------------------------------- | -------------------------------------------------- |
| `/`                       | `shared`, 1 saat TTL                     | Locale ve cihaz shell varyantı olan public sayfa   |
| `/catalog?page=2`         | `shared`, 5 dakika TTL + 1 saat SWR      | Allowlist ve normalize edilmiş query parametresi   |
| `/items/:slug`            | `shared`, 5 dakika TTL + 1 saat SWR      | Dinamik path parametresinin key'e girmesi          |
| `/data-cache`             | HTML `never`; data 10 sn TTL + 30 sn SWR | Cache'siz HTML içinde cache'li public API verisi   |
| `/account`                | `never`                                  | Kişisel HTML ve defer island                       |
| `/live`                   | `never`                                  | Stream response'un cache dışında kalması           |
| `/showcase`               | 1 saat document + 15 saniye fragment     | Birbirinden bağımsız page/fragment ömrü            |
| `server/services/menu.ts` | 4 saat TTL + 24 saat SWR                 | Birçok sayfanın paylaştığı read-through data cache |

Yeni bir cache davranışı eklemeden önce bu örneklerden en yakın olanı temel alın. `/data-cache`,
document ve data cache'in birbirinden bağımsız olduğunu gözle görünür biçimde doğrulamak içindir.

## HTML cache registry'si

`src/lib/cache-keys.ts`, HTML cache kimliklerinin tek kaynağıdır. Cache'lenen her route burada
tanımlanmalı ve route yalnız `pageCachePolicy(PageCacheId..., ctx)` çağırmalıdır. Böylece purge
allowlist'i, metric route label'ları, TTL/SWR ve key üretimi birbirinden kopmaz.

Key'e yalnız üretilen HTML'i gerçekten değiştiren, normalize edilmiş ve bounded değerler girebilir:

- Page id ilk parça olmalıdır.
- Header/footer kullanan sayfalarda `locale(ctx.request)` ve `layoutCacheFragment(ctx)` bulunmalıdır.
- Dinamik sayfada slug/id gibi path parametresi bulunmalıdır.
- Query parametreleri `contentQueryCacheFragment` allowlist'iyle alınmalıdır.
- Default değerler tek biçime indirgenmelidir; `?page=`, `?page=1` ve geçersiz page aynı key'i
  üretmelidir.

`utm_*`, `gclid`, bilinmeyen query parametreleri, kullanıcı id'si, cookie, session ve token key'e
giremez. Tracking parametreleri cardinality patlaması yaratır; kişisel değerlerse kullanıcı verisini
başka bir ziyaretçiye servis etme riski doğurur.

## Strateji seçimi

Şu sırayla karar verin:

1. HTML kişisel veri içeriyor mu? Evetse `never` kullanın veya kişisel bölümü defer island'a taşıyın.
2. Response stream, proxy, redirect veya terminal sonuç mu? Document cache kullanmayın.
3. Çıktı public ve aynı key için deterministik mi? `shared` kullanabilirsiniz.
4. HTML'i değiştiren her varyant bounded biçimde key'de mi? Değilse cache açmayın.
5. Kaynak veri birçok sayfada ortak mı? Document cache'e ek olarak data cache düşünün.
6. Yalnız bir bölüm daha kısa ömürlü mü? Fragment cache kullanın.

`shared` response'ları tarayıcı/CDN public cache'ine açmaz. Platform document'i sunucuda tutar ve
cevaba `cache-control: private, no-cache, max-age=0` yazar. `never` ve stream cevapları
`private, no-store` döner.

## TTL ve SWR nasıl seçilir?

- **TTL**, entry'nin fresh kaldığı süredir. Bu aralıkta `HIT` doğrudan döner.
- **SWR**, TTL bittikten sonra eski içeriğin servis edilebileceği ek süredir. Bu aralıkta `STALE`
  hemen döner ve background revalidation başlar.
- TTL + SWR bittiyse entry cold miss olur; istek yeni sonucu bekler.

Başlangıç noktası olarak içeriğin kabul edilebilir eskilik süresini kullanın:

| İçerik tipi              |              Başlangıç TTL | Başlangıç SWR | Not                                                 |
| ------------------------ | -------------------------: | ------------: | --------------------------------------------------- |
| Sık değişen stok/fiyat   | Cache'lemeyin veya 5–30 sn |       0–30 sn | Yanlış veri maliyetini ürün kararıyla değerlendirin |
| Katalog/liste            |                     1–5 dk |      15–60 dk | İçerik değişiminde targeted purge ekleyin           |
| Ürün detayı/CMS sayfası  |                    5–30 dk |      1–6 saat | Publish webhook'u ile page/prefix purge tercih edin |
| Navigasyon/menu          |                   1–4 saat |    12–24 saat | Gateway kesintisinde stale shell kullanılabilir     |
| Neredeyse statik landing |                  1–24 saat |       1–7 gün | Deploy namespace'i ve içerik purge süreci şarttır   |

SWR, hatayı sonsuza dek saklamaz; `staleUntil` sonrasında yeni render gerekir. Çok uzun SWR ancak
eski içeriğin iş açısından güvenli olduğu durumlarda kullanılmalıdır. Önce güvenli değerle başlayın,
sonra `x-cache`, latency, revalidation hataları ve içerik tazeliği SLO'suna göre ayarlayın.

## Request yaşam döngüsü ve stampede koruması

1. L1 memory kontrol edilir.
2. Redis açıksa L1 miss'ten sonra L2 kontrol edilir; L2 hit L1'e promote edilir.
3. Fresh entry `HIT`, stale entry `STALE` döner. Aynı key için tek background revalidation çalışır.
4. Cold miss'te aynı process içindeki istekler tek fill promise'ini paylaşır.
5. Redis varsa bir pod `cold-fill:<key>` distributed lock'ını alır; diğer podlar
   `CACHE_FILL_WAIT_MS` süresince cache'i `CACHE_FILL_POLL_MS` aralığıyla kontrol eder.
6. Bekleme timeout olursa sistem fail-open davranıp kendi render'ını yapar; trafik cevap almaya devam
   eder ama upstream yükü artabilir.
7. Başarılı ve cache'lenebilir sonuç yazılır. Redirect, not-found/gone ve hata gibi terminal sonuçlar
   cold-fill cache'ine yazılmaz.

`CACHE_FILL_TIMEOUT_MS` loader + render + write bütçesidir. `CACHE_FILL_WAIT_MS` bundan küçük olamaz;
`CACHE_FILL_POLL_MS` de wait süresini aşamaz. Bu değerleri upstream timeout ve
`SSR_REQUEST_TIMEOUT_MS` ile birlikte değiştirin; bağımsız knob'lar gibi düşünmeyin.

## Endpoint/data cache: görünür `/data-cache` örneği

`/data-cache` route'u `neverCache()` kullanır; bu nedenle response `x-cache: BYPASS` taşır ve
`pageRenderedAt` her istekte değişir. Loader'ın çağırdığı `server/services/featured-items.ts` ise
doğrulanmış `/items` gateway payload'ını `items:featured:v1` key'iyle paylaşır.

Development varsayılanı 10 saniye TTL + 30 saniye SWR'dir. Sayfayı birkaç kez yenileyerek üç durumu
görebilirsiniz:

1. İlk istek `MISS`: gateway çağrılır, `fetchedAt` üretilir ve snapshot cache'e yazılır.
2. TTL içindeki istek `FRESH`: HTML yeniden render edilir ama `fetchedAt` değişmez.
3. TTL sonrasındaki istek `STALE`: eski snapshot hemen döner ve process içinde tek background refresh
   başlar. Sonraki istekte yeni `fetchedAt` görünür.

Bu cache'e yalnız public, bounded ve runtime contract'tan geçmiş veri yazılır. Request cookie,
authorization, session veya kullanıcı id'si key'e ya da payload'a eklenmez. Bozuk cache entry'si
silinip cold miss olarak yeniden doldurulur. `FEATURED_ITEMS_CACHE_TTL` ve
`FEATURED_ITEMS_CACHE_SWR` örneğin hızını ayarlar; gerçek projede ürünün kabul edilebilir veri
eskiliğine göre değiştirilmelidir.

```bash
# HTML hiçbir zaman HIT olmamalı; veri zamanı TTL boyunca aynı kalmalı.
curl -si http://127.0.0.1:3010/data-cache | rg "x-cache|HTML render|Gateway veri"

# Yalnız örnek data cache entry'lerini temizle.
curl -sS -X POST http://127.0.0.1:9010/api/internal/cache/purge \
  -H "content-type: application/json" \
  --data '{"prefix":"items:featured:"}'
```

## Endpoint/data cache: menu örneği

`server/services/menu.ts`, SSR document cache'inden bağımsız bir read-through örneğidir. Key
`menu:public:v1`, TTL/SWR değerleri `MENU_CACHE_TTL` ve `MENU_CACHE_SWR` ile yönetilir.

- Fresh hit gateway'e gitmez.
- Stale hit hemen döner ve process içinde tek background refresh başlatır.
- Cold miss istekleri aynı single-flight refresh'i paylaşır.
- Gateway payload'ı cache'e yazılmadan önce runtime contract ile doğrulanır.
- Public menu çağrısına `Authorization` taşınmaz.
- Bozuk/eski cache değeri miss sayılır.
- Local fallback yalnız kontrollü degradation içindir ve cache'e yazılmaz.

Menu şeması veya render anlamı değiştiğinde key versiyonunu `menu:public:v2` yapın. İçerik değişiminde
versiyon artırmak yerine `menu:` prefix purge kullanın. Menu purge, ilişkili header/footer fragment
entry'lerini de temizler.

## Fragment cache

`/showcase`, uzun ömürlü document içine kısa ömürlü fragment yerleştirir. Fragment çıktısı da public,
deterministik ve güvenilir HTML olmalıdır. Shell verisi eksik veya runtime contract'a aykırıysa
`isShellUsableForFragments` false dönmelidir; bozuk chrome'u cache'e yazmak yerine normal
render/degradation yolu kullanılmalıdır.

Fragment key'i, document key'inden bağımsızdır. Fragmentin çıktısını değiştiren locale, device veya
içerik fingerprint'i kendi key'inde bulunmalıdır.

## L1 memory ve Redis topolojisi

Platformda L1 memory her zaman vardır. `CACHE_BACKEND=redis` ve `REDIS_URL` ile Redis L2 eklenir:

| Kurulum                         | Kullanım                                     | Davranış                                                        |
| ------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `memory`, tek pod               | Local/geliştirme ve tek instance             | Hızlıdır; restart'ta silinir                                    |
| `memory`, çok pod               | Önerilmez                                    | Her pod farklı entry tutar; purge ve SWR tutarsızlaşır          |
| `redis`, `CACHE_REQUIRED=false` | Redis faydalı ama uygulama için kritik değil | Redis yoksa L1-only devam eder; readiness ayakta kalır          |
| `redis`, `CACHE_REQUIRED=true`  | Shared cache production gereksinimiyse       | Redis startup/ping sorunu boot veya readiness'i başarısız yapar |

Redis runtime read hatası miss sayılır. L2 write hatasında L1 write devam eder. Başarılı L2 yazımı ve
purge, pub/sub invalidation ile diğer podların L1 entry'sini düşürür. Subscriber kurulamazsa ve cache
opsiyonelse uygulama L1 ile devam eder fakat podlar arası L1 senkronizasyonu kaybolur; alarm üretin.

`RELEASE_ID`, Redis namespace'inin parçasıdır. Aynı release'in bütün podları aynı değeri kullanmalı;
yeni deploy yeni ve benzersiz bir değer almalıdır. Her uygulama da ayrı namespace kullanmalıdır.
Blue/green release'ler böylece birbirinin HTML'ini paylaşmaz.

## `x-cache` ile yerel doğrulama

Header'ları görmek için `HEAD` yerine gerçek `GET` çalıştırın; ilk istek fill yapar:

```bash
APP_URL=http://127.0.0.1:3010
curl -sS -o /dev/null -D - "$APP_URL/catalog?page=2&utm_source=test"
curl -sS -o /dev/null -D - "$APP_URL/catalog?page=2"
curl -sS -o /dev/null -D - "$APP_URL/account"
```

Beklenen durumlar:

- `MISS`: entry yoktu; render edildi ve yazıldı.
- `HIT`: fresh entry kullanıldı.
- `STALE`: stale entry hemen döndü; revalidation planlandı.
- `BYPASS`: route/request shared cache'i kullanmadı.
- `ERROR`: cache/render akışı kontrollü hata yoluna düştü.
- `REDIRECT` / `PROXY`: cache bu response tipine dahil olmadı.

İlk iki katalog çağrısı aynı normalize edilmiş key'i kullanmalıdır; tracking parametresi yeni entry
oluşturmamalıdır.

## Cache inspect ve purge

Bu endpoint'ler public `PORT` üzerinde değil, yalnız `METRICS_PORT` operations listener'ındadır.
Production'da `CACHE_PURGE_SECRET` yoksa 503; secret varsa Bearer token veya
`X-Cache-Purge-Token` zorunludur. Development'ta secret tanımlanmamışsa endpoint açıktır.

```bash
OPS_URL=http://127.0.0.1:9010
CACHE_TOKEN=change-me

# İlk sayfa; response cursor döndürürse sonraki isteğe ekleyin.
curl -sS "$OPS_URL/api/internal/cache/keys?limit=50" \
  -H "authorization: Bearer $CACHE_TOKEN"

# Prefix'e göre inspect (wildcard kullanılmaz).
curl -sS "$OPS_URL/api/internal/cache/keys?prefix=catalog&limit=50" \
  -H "authorization: Bearer $CACHE_TOKEN"

# Registry'deki bir veya daha fazla sayfayı temizle.
curl -sS -X POST "$OPS_URL/api/internal/cache/purge" \
  -H "authorization: Bearer $CACHE_TOKEN" \
  -H "content-type: application/json" \
  --data '{"pageIds":["catalog"]}'

# Data cache ve ilişkili menu fragmentlerini temizle.
curl -sS -X POST "$OPS_URL/api/internal/cache/purge" \
  -H "authorization: Bearer $CACHE_TOKEN" \
  -H "content-type: application/json" \
  --data '{"prefix":"menu:"}'

# Inspect response'undaki encoded key'i güvenli biçimde geri gönder.
curl -sS -X POST "$OPS_URL/api/internal/cache/purge" \
  -H "authorization: Bearer $CACHE_TOKEN" \
  -H "content-type: application/json" \
  --data '{"keysEncoded":["INSPECT_RESPONSE_ENTRY_KEY_ENCODED"]}'
```

Ham `keys` de desteklenir; delimiter/escape hatası yaşamamak için otomasyonda `keysEncoded` tercih
edin. Tek istekte en fazla 500 key/page id silinir, inspect `limit` en fazla 200'dür. `prefix` glob
değildir; `*` ve `?` reddedilir. `{"all":true}` yalnız incident/emergency için son çare olmalıdır.

## Metric ve alarm rehberi

`/metrics` operations portundadır. İlk dashboard için şu sinyaller yeterlidir:

- `ssr_http_requests_total{cache=...}`: HIT/MISS/STALE/BYPASS oranı.
- `ssr_cache_response_duration_milliseconds`: cache state bazında response latency.
- `ssr_cache_fill_total{outcome=...}` ve `ssr_cache_fill_duration_milliseconds`: cold-fill sonuç/süre.
- `ssr_cache_coalesced_wait_total{scope=...,outcome=...}`: process/Redis arkasında birleşen istekler.
- `ssr_cache_lock_timeout_total`: Redis cold-fill bekleme bütçesi aşımları.
- `ssr_cache_revalidations_total{outcome=...}`: SWR success/error/lock_miss.
- `ssr_cache_operations_total{backend=...,operation=...,outcome=...}`: store hataları.
- `ssr_cache_l2_healthy`: Redis son ping sonucu; 0 olduğunda alarm üretin.
- `ssr_cache_promotion_total{source="l2"}`: L2 hit'in L1'e taşınması.
- `ssr_cache_distinct_keys_observed{route=...}` ve `ssr_cache_cardinality_overflow_total`: key
  cardinality riski.
- `ssr_cache_entry_body_bytes` ve `ssr_cache_key_bytes`: entry/key boyutları.

Örnek PromQL:

```promql
sum by (cache) (rate(ssr_http_requests_total[5m]))
sum by (outcome) (rate(ssr_cache_fill_total[5m]))
sum(rate(ssr_cache_lock_timeout_total[5m]))
sum by (outcome) (rate(ssr_cache_revalidations_total[5m]))
max(ssr_cache_l2_healthy)
```

MISS artışı tek başına incident değildir; deploy sonrası cold cache beklenir. Sürekli MISS ile birlikte
fill error/timeout, gateway latency veya cardinality artışı varsa key üretimini, Redis sağlığını ve
write hatalarını birlikte inceleyin.

## Deploy ve içerik değişikliği runbook'u

Deploy öncesi:

1. Aynı release'teki tüm podların aynı, yeni deploy'un önceki deploy'dan farklı `RELEASE_ID`
   kullandığını doğrulayın.
2. Multi-pod production'da Redis ve gerekiyorsa `CACHE_REQUIRED=true` ayarlayın.
3. `CACHE_PURGE_SECRET` değerini secret manager'dan operations listener'a verin; public ingress'e bu
   listener'ı açmayın.
4. TTL/SWR'nin içerik tazeliği hedefiyle uyumlu olduğunu gözden geçirin.

Deploy sonrası:

1. `/readyz` ve `ssr_cache_l2_healthy` değerini kontrol edin.
2. Temsilî public rotaya iki GET atıp `MISS -> HIT` akışını doğrulayın.
3. Inspect endpoint'inde beklenen page prefix'lerini ve backend'i kontrol edin.
4. Fill timeout, revalidation error ve cardinality metriklerini deploy penceresinde izleyin.

Aynı release içinde CMS/içerik değiştiğinde önce en dar purge'i seçin: exact encoded key, ardından
`pageIds`, ardından data prefix. `all` purge tüm trafiği aynı anda cold miss'e çevireceği için normal
publish akışında kullanılmamalıdır.

## Yeni cache ekleme kontrol listesi

- [ ] Çıktı public ve deterministik; kişisel veri/token/cookie içermiyor.
- [ ] HTML route'u `src/lib/cache-keys.ts` registry'sine eklendi.
- [ ] Locale, device, path ve allowlist edilmiş query varyantları eksiksiz fakat bounded.
- [ ] TTL/SWR içerik tazeliği hedefinden türetildi.
- [ ] Invalid payload, terminal sonuç ve fallback cache'e yazılmıyor.
- [ ] İçerik değişikliği için exact key/page id/prefix purge yolu belirlendi.
- [ ] İlk request `MISS`, ikincisi `HIT`; kişisel route `BYPASS` testi var.
- [ ] Multi-pod davranışı Redis kesintisi dahil doğrulandı.
- [ ] Dashboard ve alarmlar fill, revalidation, L2 health ve cardinality sinyallerini kapsıyor.
