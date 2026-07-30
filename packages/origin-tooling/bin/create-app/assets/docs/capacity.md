# Kapasite testi ve raporlama

React template tek komutla tekrarlanabilir bir lokal kapasite provası taşır:

```bash
pnpm capacity
```

Komut production build'i alır, boş portlar seçer, uygulamayı ve template mock gateway'ini kendisi
başlatır. Mevcut `pnpm dev`, `pnpm start` veya 4002 portundaki başka bir mock gateway'e dokunmaz.
Tamamlandığında geçici process'leri kapatır.

React standalone template, güncel Autocannon 8'in eski `hyperid@3 → uuid@8` zincirini çekmemesi için
yalnız `autocannon>hyperid` kenarını API-uyumlu `hyperid@4` sürümüne sabitler. Bu genel bir dependency
override değildir; production runtime'a girmez ve `pnpm audit --prod` sonucunu etkilemez. Autocannon
bu bağımlılık aralığını upstream'de güncellediğinde override kaldırılmalıdır.

## Full profil

Varsayılan profil bütün örnek HTML route'larını şu bağlantı sayılarında çalıştırır:

```text
10 → 25 → 50 → 100 → 200 → 400
```

Her route 30 saniye warm-up edilir. Her kademe 60 saniye ve üç tekrar çalışır; tekrarlar arasında
5 saniye cooldown bulunur. Stage/repeat sırasında route sırası döndürülerek JIT ve termal sıra etkisi
tek route üzerinde biriktirilmez. Route sayısına ve makine hızına göre yaklaşık dört saat sürmesi
normaldir. Test
başlamadan önce tahmini süre terminale yazılır.

Her ölçümde autocannon sonuçlarının yanında şunlar toplanır:

- RPS median/min/max ve tekrarlar arası değişkenlik katsayısı
- Ortalama, p50, p95, p99 ve maksimum latency
- Exact HTTP status dağılımı, network error ve timeout
- Uygulama CPU, RSS, heap ve event-loop p95/p99
- Load generator CPU
- HTML `HIT`, `MISS`, `STALE`, `BYPASS`, `REDIRECT` sayıları
- Gateway request, cache fill, request timeout ve render rejection delta'ları
- Mock gateway'in path bazlı gerçek çağrı sayıları

## Cache deneyleri

Route matrisi bittikten sonra runner cache'i kontrollü temizleyerek şu deneyleri yapar:

1. `/catalog` cold burst: eşzamanlı miss'lerin tek loader/gateway çağrısına birleşmesi.
2. `/data-cache` cold burst: cache'siz HTML isteklerinin tek API data fill'ini paylaşması.
3. `/data-cache` stale burst: birçok stale isteğin tek background refresh başlatması.
4. Warm data cache: HTTP request / gateway request koruma oranı.
5. `/api/items`: origin data cache olmadığında HTTP ve gateway çağrılarının yaklaşık 1:1 olması.

Mock gateway yalnız lokal fixture'dır. `GET /__originloom__/stats` sayaçları döndürür, `DELETE` aynı
sayaçları sıfırlar. Bu instrumentation production server'a eklenmez.

## Raporlar

```text
load-test/reports/latest.md
load-test/reports/latest.json
load-test/reports/capacity-<timestamp>.md
load-test/reports/capacity-<timestamp>.json
```

Markdown rapor yönetici özeti, önerilen connection kademesi, saturation knee, ayrıntılı matris,
cache deneyleri, ortam ve metodolojiyi içerir. JSON dosyası her autocannon tekrarını, status
dağılımlarını, kaynak peak'lerini, metric delta'larını ve gateway sayaçlarını korur. Rapor klasörü
gitignore'dadır; paylaşmak istediğiniz raporu bilinçli olarak başka yere kopyalayın.

Knee otomatik olarak ilk şu koşullardan birinde işaretlenir:

- Hata, timeout veya beklenmeyen HTTP status
- Event-loop p99 değerinin 100 ms'yi geçmesi
- Önceki kademeye göre RPS artışı `%10` altında kalırken p99 artışının `%25` üzerine çıkması

Bu eşikler başlangıç teşhisidir; ürün SLO'su tanımlandığında rapor onunla birlikte yorumlanmalıdır.

## Kısa ve özel çalıştırmalar

```bash
pnpm capacity:quick
pnpm capacity -- --only catalog,data-cache
pnpm capacity -- --connections 25,50,100 --duration 60 --repeats 5
pnpm capacity -- --gateway-delay-ms 20
pnpm capacity -- --strict # herhangi bir geçersiz matriste non-zero exit
pnpm capacity -- --profile-on-knee
```

`--gateway-delay-ms`, mock gateway'e kontrollü latency ekleyerek cache korumasını sıfır-latency lokal
fixture dışında da gözlemlemeyi sağlar. Full rapordan önce `capacity:quick` ile wiring kontrolü yapmak
yararlıdır.

Full profil saturation bulmak için bilerek yüksek bağlantı sayılarına çıkar. Bu nedenle ana matris
hata/timeout bulsa bile raporu tamamlayıp varsayılan olarak başarılı çıkar; rapor genel durumu
`İNCELE` işaretler. CI veya regression kapısında herhangi bir geçersiz kademenin komutu da kırmasını
istiyorsanız `--strict` kullanın. Cache single-flight/upstream koruma deneyinin başarısız olması her
zaman non-zero exit üretir.

## Aynı makinede ölçümün sınırı

Autocannon, uygulama ve mock gateway aynı CPU/belleği paylaşır. Runner bunu raporda açıkça belirtir;
uygulama process metriklerini load generator CPU'sundan ayrı toplar ve host load average değerlerini
kaydeder. Buna rağmen sonuç production kapasitesi veya pod sayısı hesabı değildir.

Bu test şu konularda güvenilirdir:

- Aynı makinede iki OriginLoom sürümünü karşılaştırmak
- Bir değişiklik sonrası regression yakalamak
- Cache stampede/single-flight davranışını doğrulamak
- Hata ve latency'nin yükselmeye başladığı yerel saturation knee'yi bulmak

Gerçek production kapasitesi için daha sonra ayrı load-generator makinesi, gerçek gateway latency,
TLS/load balancer ve production Redis topolojisiyle aynı profil tekrarlanmalıdır.

Payload/serialization hard budget'ları, baseline kabulü ve ayrı-process CPU/heap profiling akışı için
[performans kabul politikası](./performance-acceptance.md) dokümanına bakın.
