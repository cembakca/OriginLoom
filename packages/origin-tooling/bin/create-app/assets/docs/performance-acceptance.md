# Performans kabul politikası, payload bütçeleri ve profiling

Bu doküman kapasite ölçümünü bir release kararına dönüştürür. Üç farklı kavramı birbirine
karıştırmayın:

1. **Hard budget:** tek çalışmada aşılması doğrudan hata olan güvenlik/kalite sınırı.
2. **Regression baseline:** aynı ortam ve aynı profil arasında kabul edilmiş sürüme göre değişim.
3. **Profiling:** regresyonun kaynağını arayan teşhis çalışması; profiler açıkken görülen RPS baseline
   olamaz.

## Tek komutluk akış

```bash
pnpm capacity
```

Production build'i ve bütün kapasite matrisini çalıştırır; cache deneyleri, response payload probe'ları,
serialization histogramları ve varsa `performance-baseline.json` karşılaştırmasını aynı Markdown/JSON
raporuna ekler. Hard payload veya serialization bütçesi, cache doğruluk deneyi ya da karşılaştırılabilir
baseline regresyonu başarısızsa komut non-zero çıkar.

Kapasite ölçümü başlamadan önce memory cache doğruluk matrisi ayrı process'te çalışır: cold/stale burst,
negative cache, stale-if-error ve byte eviction başarısızsa RPS sonucu üretilmez. Paketi tek başına
çalıştırmak için `pnpm cache:acceptance` kullanın. Gerçek Redis regresyon matrisi opt-in'dir:

```bash
REDIS_URL=redis://127.0.0.1:6379 pnpm cache:acceptance:redis
```

Bu ikinci matris iki bağımsız Node process'iyle distributed cold fill/revalidation, L2 promotion,
pub/sub L1 invalidation ve optional/required Redis degradation davranışlarını doğrular. Uygulama kaynak
kodu topology'yi bilmez; yalnız `CACHE_BACKEND`, `CACHE_REQUIRED` ve `REDIS_URL` değişir.

İlk kurulumda baseline bulunmaması hata değildir; raporda `BASELINE YOK` görünür. Önce stabil bir full
raporu inceleyin, sonra bilinçli olarak kabul edin:

```bash
pnpm performance:accept
git add performance-baseline.json
```

Sonraki bir raporu ayrıca karşılaştırmak için:

```bash
pnpm performance:compare
pnpm performance:compare -- --report load-test/reports/capacity-<timestamp>.json
```

Baseline otomatik güncellenmez. Değişiklik gerçekten bekleniyorsa yeni full raporu review edip
`performance:accept` çalıştırın; baseline diff'inde hangi route ve metriğin neden değiştiğini PR'da
açıklayın. Kabul komutu; cache deneylerinden, payload/serialization hard budget'larından veya ölçüm
güvenilirliği kontrollerinden biri başarısızsa baseline yazmaz. Eksik sonuç alanları bulunan eski
raporlar da yeni baseline olarak kabul edilmez.

## Karşılaştırılabilirlik kuralları

Baseline karşılaştırması yalnız şu alanlar aynıysa geçerlidir:

- platform ve CPU mimarisi;
- Node major sürümü;
- mantıksal CPU sayısı;
- profil adı, route listesi ve connection kademeleri;
- warm-up, kademe süresi ve tekrar sayısı;
- mock gateway delay ayarı.
- cache topology (`memory` veya `memory+redis`);
- ingress compression profili (`identity` veya `gzip`).

Uyumsuz rapor başarısız regresyon diye yorumlanmaz; `UYUMSUZ / KARŞILAŞTIRILMADI` olur. CI için aynı
runner sınıfını ve sabit Node sürümünü kullanın. CV ve generator CPU eşikleri
`performance-policy.json` içindeki `reliability` bölümünden okunur. Eşik aşılırsa ölçüm baseline için
güvenilir sayılmaz; makine yükünü düşürüp tekrar çalıştırın.

## Varsayılan regresyon eşikleri

`performance-policy.json` source control'dadır:

| Metrik                                   |      Release bloklama eşiği |
| ---------------------------------------- | --------------------------: |
| Median RPS                               | `%10` veya daha fazla düşüş |
| p95 latency                              | `%20` veya daha fazla artış |
| p99 latency                              | `%25` veya daha fazla artış |
| RSS peak                                 | `%20` veya daha fazla artış |
| Event-loop p99                           | `%25` veya daha fazla artış |
| Document render / gateway JSON parse p95 | `%20` veya daha fazla artış |
| HTML veya island props                   | `%10` veya daha fazla artış |

Yüzde eşikleri ürünün mutlak SLO'sunun yerine geçmez. Örneğin baseline p99 zaten kabul edilemezse
`%0` regresyon iyi sonuç değildir. Ürün SLO'larını ayrıca dashboard/alert katmanında tanımlayın.

## Payload hard budget'ları

Varsayılan template limitleri:

| Payload                             |           Limit | Ölçüm                                                    |
| ----------------------------------- | --------------: | -------------------------------------------------------- |
| Route SSR HTML                      |         100 KiB | `Accept-Encoding: identity` response body                |
| Bir route'taki island props toplamı |          50 KiB | HTML içindeki bütün `data-props` attribute'ları          |
| Tek island props                    |          20 KiB | En büyük `data-props` attribute'u                        |
| Gateway JSON contract               | Contract'a özel | `defineGatewayContract(..., maxBytes)` ve bounded reader |
| Document render p95                 |           50 ms | `ssr_serialization_duration_milliseconds`                |
| Gateway JSON parse p95              |           10 ms | Aynı histogramın `gateway_json_parse` serisi             |

HTML probe ağ transferi değil, sıkıştırılmamış document büyüklüğüdür. Lighthouse script transfer
bütçesi ve `performance-budgets.json` içindeki gzip JS bütçeleri ayrı katmanlardır. Üçü birlikte
korunmalıdır.

Identity ve gzip ölçümlerini aynı baseline'a yazmayın. Varsayılan `pnpm capacity` identity profilidir;
`pnpm capacity:gzip` sıkıştırılmış transfer profilidir. Ayrı baseline dosyaları kullanın:

```bash
pnpm capacity -- --baseline performance-baseline.identity.json
pnpm capacity:gzip -- --baseline performance-baseline.gzip.json
```

HTML/island hard budget probe'u her iki profilde de bilinçli olarak identity body üzerinde çalışır;
autocannon throughput ve response latency ise seçilen ingress `Accept-Encoding` profiline aittir.

React Query bu template'te client-side session sorgusunda kullanılır; server dehydration eklenirse
dehydrated state'i ayrı bir HTML işaretleyicisiyle ölçüp `performance-policy.json` içine bağımsız hard
budget ekleyin. Veriyi genel HTML toplamının içinde bırakmak hangi payload'ın büyüdüğünü gizler.

Core aşağıdaki bounded-cardinality Prometheus serilerini üretir:

```text
ssr_serialization_duration_milliseconds{kind="document_render",label="/catalog"}
ssr_serialization_duration_milliseconds{kind="gateway_json_parse",label="items"}
ssr_payload_size_bytes{kind="html",label="/catalog"}
ssr_payload_size_bytes{kind="gateway_json",label="items"}
```

`label`, raw URL değildir: route pattern veya kodda tanımlı gateway contract adıdır. Query, slug,
session veya kullanıcı girdisini metric label yapmayın.

## Profiling

Belirli bir route'u production bundle üzerinde ayrı process'te profilleyin:

```bash
pnpm capacity:profile
pnpm capacity:profile -- --route catalog --connections 100 --duration 45 --warmup 15
```

Full kapasite testinin bulduğu her knee'yi otomatik yeniden çalıştırmak için:

```bash
pnpm capacity -- --profile-on-knee
pnpm capacity -- --profile-on-knee --profile-duration 45
```

Her profilli tekrar yeni bir app ve mock gateway başlatır. Warm-up bittikten sonra Node inspector
üzerinden CPU profiler ve heap allocation sampling başlatılır; startup allocation'ları ölçümden
ayrılır. Sonuçlar:

```text
load-test/reports/profiles/<timestamp>-<route>-c<connections>/
├── <route>-c<connections>.cpuprofile
├── <route>-c<connections>.heapprofile
├── metadata.json
└── summary.md
```

`.cpuprofile` Chrome DevTools Performance panelinde açılabilir. `.heapprofile` allocation sampling
profilidir; summary en çok CPU sample alan frame'leri ve en yüksek self allocation değerlerini
listeler. Production bundle'ın yanındaki source map DevTools'ta kaynak frame'lere dönmek için
kullanılabilir; Markdown özeti generated `dist/server/index.js` konumunu gösterebilir.

Profiler overhead eklediğinden profilli koşunun RPS, latency ve CPU değerlerini normal kapasite
baseline'ına almayın. Heap snapshot otomatik alınmaz: snapshot stop-the-world davranışı, yüksek disk
ve bellek tüketimi nedeniyle ancak kontrollü bir teşhis oturumunda manuel alınmalıdır.

## CI ve kabul akışı

Önerilen release akışı:

1. PR'da typecheck, test, bundle bütçesi, Axe ve Lighthouse kapıları çalışır.
2. Sabit/dedicated runner'da full `pnpm capacity` çalışır.
3. Hard budget veya baseline regresyonu release'i bloklar.
4. Gürültülü/uyumsuz ölçüm baseline'ı değiştirmez; aynı ortamda tekrar edilir.
5. Regresyon gerçekse `capacity:profile` ile darboğaz bulunur.
6. Beklenen ürün değişikliği ise yeni baseline ayrıca review edilip kabul edilir.

`load-test/reports/` gitignore'dadır; `performance-baseline.json` ise bilinçli olarak değildir.
Timestamp'li ham JSON'u CI artifact olarak saklayın. Markdown karar özeti içindir; ayrıntılı tekrarlar,
status dağılımları ve metric delta'ları JSON raporundadır.
