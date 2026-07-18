# Dynamic Rendering Bizi Neden Next.js’ten Uzaklaştırdı?

> Next.js’ten Hono ve React tabanlı explicit SSR mimarisine geçişimizin teknik nedenleri

Bir framework’ten çıkma kararı çoğu zaman yanlış anlatılır. Ekip yeni bir teknolojiye heves etmiş,
mevcut araç yetersiz kalmış veya sıfırdan altyapı yazmak daha “mühendisçe” görünmüş gibi düşünülür.
Bizim hikâyemizde bunların hiçbiri belirleyici değildi.

Next.js bize uzun süre çok değerli bir başlangıç noktası sağladı. Routing, React ile server-side
rendering, build optimizasyonları, kod bölme ve deployment modeli gibi zor problemlerin büyük kısmını
hazır olarak çözüyordu. Sorun, Next.js’in bunları yapamaması değildi. Sorun, projemiz büyüdükçe hangi
sayfanın neden dinamik render edildiğini, hangi girdinin cache’i etkilediğini ve bir request’in hangi
cache katmanından cevap aldığını yeterince açık biçimde ifade edememeye başlamamızdı.

Dynamic rendering başlı başına problem değildi. Problem, dynamic rendering kararının bizim domain
modelimizin açık bir parçası olmaktan çıkıp component ağacından, request API’lerinden ve framework
kurallarından türetilen bir sonuç haline gelmesiydi.

Bu yazı “Next.js kötüdür” iddiası taşımıyor. Next.js’in güncel sürümleri static ve dynamic içeriği
birleştirmek için Cache Components, `use cache` ve Partial Prerendering gibi gelişmiş araçlar sunuyor.
Resmî dokümantasyon da `cookies`, `headers`, `searchParams` ve uncached data gibi request-time
girdilerin rendering sınırlarını nasıl etkilediğini açıkça anlatıyor. Bizim kararımız, Next.js’in
bugünkü veya gelecekteki bütün yeteneklerine karşı verilmiş genel bir hüküm değil. Bu, belirli bir
ürünün operasyonel ihtiyaçlarıyla framework’ün karar modeli arasındaki uyumsuzluğa dair bir vaka
çalışmasıdır.

## Her şey küçük bir kişiselleştirme ihtiyacıyla başladı

İlk gereksinim son derece sıradandı: kullanıcı giriş yapmışsa header’da “Giriş yap” yerine hesabını
göstermek istiyorduk. Ardından birkaç ihtiyaç daha geldi:

- Bazı sayfalarda access token gateway’e iletilmeliydi.
- Access token süresi dolduğunda refresh token ile sunucu tarafında yenilenmeliydi.
- Kampanya ve yönlendirme bilgileri cookie veya header üzerinden okunmalıydı.
- Sayfalar şehir, cihaz tipi ve belirli query parametrelerine göre farklı HTML üretebilmeliydi.
- Aynı zamanda bu sayfaların büyük bölümü paylaşımlı HTML cache’inden servis edilmeliydi.
- Kullanıcıya özel hiçbir veri başka bir kullanıcıya ait cache entry’sine sızmamalıydı.

Bu maddelerin her biri tek başına kolay görünüyordu. Bir cookie okumak, bir header taşımak veya bir
`fetch` çağrısını cache dışı bırakmak zor değildi. Zorluk, bu kararların birleştiğinde route’un toplam
rendering davranışını değiştirmesiydi.

Next.js’in rendering modelinde request-time bilgiye ihtiyaç duyan kod doğası gereği runtime’da
çalışmak zorundadır. Güncel dokümantasyon; `cookies`, `headers`, `connection`, `draftMode`,
`searchParams` ve `no-store` fetch gibi girdileri dynamic rendering sınırları içinde sayıyor.
[Next.js Partial Prerendering dokümantasyonu](https://nextjs.org/docs/canary/app/building-your-application/rendering/partial-prerendering)
bu ayrımı doğrudan tanımlıyor.

Bu davranış mantıksız değil. Build sırasında bilinmeyen bir cookie değerini kullanarak herkese aynı
HTML’i üretmek zaten mümkün değil. Bizim için sorun teknik gerekçenin doğruluğu değil, bu etkinin
kapsamı ve operasyonel sonucuydu.

Header’daki küçük bir kullanıcı göstergesi yüzünden bütün route’un request-time davranışını yeniden
düşünmek zorunda kalıyorduk. Route gerçekten kullanıcıya özel değildi. Ana içerik, SEO metadata’sı,
menü ve ürün listesi binlerce kullanıcı için aynıydı. Buna rağmen component ağacının bir köşesinde
request bilgisi okunması, sayfanın bütünü için cache ve rendering tartışması başlatabiliyordu.

Bizim asıl sorumuz şuydu:

> Bir sayfanın yüzde biri kullanıcıya özelse neden kalan yüzde doksan dokuzun cache politikasını da
> aynı rendering kararı belirlesin?

## “Dynamic” kelimesi tek başına yeterince bilgi vermiyordu

Bir route’un dynamic olduğunu bilmek operasyon için yeterli değildir. Şu soruların da cevabı gerekir:

- Route neden dynamic?
- Hangi request alanı HTML’i değiştirdi?
- Bu alan cache key’inin bir parçası mı?
- Kullanıcı token’ı yalnızca gateway isteğine mi eklendi, yoksa render edilen HTML’i de değiştirdi mi?
- Query parametrelerinden hangileri içerik girdisi, hangileri yalnızca tracking bilgisi?
- Response process-local cache’ten mi, paylaşımlı cache’ten mi, CDN’den mi geldi?
- Stale içerik servis edildiyse revalidation’ı kim başlattı?
- Revalidation başarısız olursa eski içerik korunuyor mu?
- Birden fazla replica aynı içeriği eş zamanlı yenilemeye çalışıyor mu?

“Bu route dynamic” cevabı bütün bu durumları aynı sepete koyuyordu. Oysa aşağıdaki iki sayfa teknik
olarak request-time bilgi kullanmasına rağmen aynı cache politikasına sahip olmamalıydı:

1. Access token’ı yalnızca gateway’e ileten ama herkese aynı public HTML’i üreten sayfa.
2. Kullanıcının adını, tekliflerini veya hesap bilgisini SSR HTML’ine koyan sayfa.

İlk sayfa güvenli biçimde shared cache kullanabilir. İkinci sayfa kullanıcı bazlı cache veya tamamen
cache dışı rendering gerektirir. Bizim domain’imizde önemli ayrım “request sırasında çalışıyor mu?”
değil, “üretilen HTML hangi girdilere göre değişiyor?” sorusuydu.

Framework seviyesindeki static/dynamic ayrımı ile ürün seviyesindeki shared/personalized ayrımı
birbirinin tam karşılığı değildi.

## Cache key’ini göremiyorsak cache’i yönetemiyoruz

Cache yalnızca performans optimizasyonu değildir. Yanlış tasarlandığında veri sızıntısına, güncel
olmayan içeriğe ve replica’lar arasında tutarsız davranışa neden olabilir. Bu nedenle cache key’inin
hangi girdilerden oluştuğu bizim için bir implementasyon ayrıntısı değil, route kontratıydı.

Bir ihtiyaç kredisi sayfasını düşünelim:

```text
/ihtiyac-kredisi/istanbul?amount=100000&utm_source=google
```

Bu URL’de:

- `istanbul` içeriği değiştirir.
- `amount=100000` teklifleri değiştirir.
- Cihaz tipi farklı bir HTML shell üretebilir.
- Dil tercihi metadata ve metinleri değiştirebilir.
- `utm_source=google` ise analytics içindir; HTML cache key’ini değiştirmemelidir.

Cache key’i URL’nin tamamından oluşursa her kampanya parametresi yeni bir entry üretir. UTM,
`gclid` veya sırası değişmiş query parametreleri cache cardinality’sini gereksiz yere büyütür. Cache
key’i fazla dar tutulursa bu kez farklı miktarlar veya şehirler aynı HTML’i paylaşabilir.

Biz şunu istiyorduk:

```ts
["loan", city, `amount=${normalizedAmount}`, device, locale, theme];
```

Bu listeyi route’un davranışından tahmin etmek değil, doğrudan kodda görmek istiyorduk. Hangi
değerin neden key’e girdiği review sırasında tartışılabilmeliydi. Yeni bir query parametresi ekleyen
geliştirici, bunun yalnızca analytics girdisi mi yoksa HTML varyasyonu mu olduğunu açıkça seçmeliydi.

Next.js’in cache modeli güçlüdür ve güncel Cache Components yaklaşımı fonksiyon argümanlarını cache
key’inin parçası haline getirebilir. `use cache` dokümantasyonu ayrıca `cookies` ve `headers` gibi
runtime değerlerinin cached scope dışında okunup argüman olarak geçirilmesini öneriyor.
[Resmî `use cache` dokümantasyonu](https://nextjs.org/docs/app/api-reference/directives/use-cache)
bu konuda önemli ölçüde daha explicit bir model sunuyor.

Fakat bizim geçiş kararımızın verildiği noktada problem yalnızca bir fonksiyonun cache’lenmesi
değildi. Route HTML’i, Redis key’i, stale penceresi, purge davranışı, auth bypass ve gözlemlenebilirlik
aynı kontratta birleşmeliydi. Cache’in sahibi framework değil, uygulamanın route tanımı olsun istedik.

## Kişiselleştirme ile shared HTML’i ayırmak

İlk refleks, access veya refresh token bulunan bütün istekleri cache dışı bırakmaktı:

```text
token var → BYPASS
token yok → shared cache
```

Bu güvenli görünüyordu; fakat gereğinden pahalıydı. Kullanıcı giriş yaptıktan sonra public sayfaların
tamamı cache’i bypass ediyordu. Oysa bu sayfaların SSR çıktısında kullanıcıya ait hiçbir veri yoktu.
Header’daki hesap alanı dışında anonim ve giriş yapmış kullanıcı aynı HTML’i alabilirdi.

Burada önemli bir ilkeye ulaştık:

> Cache bypass kararı kullanıcının oturumunun bulunmasına göre değil, SSR HTML’inin oturuma göre
> değişmesine göre verilmelidir.

Bu ayrım sonucunda üç route tipi ortaya çıktı:

### Cache-safe public route

Token bulunabilir, middleware token’ı gateway’e iletebilir; fakat üretilen HTML kullanıcıya göre
değişmez. Bu route shared cache kullanmaya devam eder.

### Auth-personalized SSR route

Loader kullanıcının profilini veya kullanıcıya özel gateway cevabını HTML’e koyar. Token varsa
shared cache bypass edilir.

### Kişisel client island route’u

SSR yalnızca herkese ortak bir shell üretir. Kişisel panel browser’da ayrı bir BFF isteğiyle yüklenir.
Kişisel veri hiçbir zaman shared HTML’e girmez.

Bu model bizi Island Architecture’a götürdü. Kullanıcı menüsü, hesap özeti veya filtre paneli gibi
alanlar sayfanın tamamının rendering stratejisini belirlememeliydi. Etkileşimli veya kişisel alanları
bağımsız island’lara ayırarak shared HTML ile kullanıcı state’i arasına fiziksel bir sınır koyduk.

## Çözmeye çalıştığımız şey yalnızca ilk response süresi değildi

Dynamic rendering tartışmaları çoğu zaman TTFB veya CDN hit ratio üzerinden yürütülür. Bizim için
operasyonel tahmin edilebilirlik en az performans kadar önemliydi.

Bir production incident sırasında şu soruya hızlı cevap vermek istiyorduk:

> Bu request neden cache’ten gelmedi?

Cevap loglardan görülebilmeliydi:

```text
x-cache: HIT
x-cache: MISS
x-cache: STALE
x-cache: BYPASS
```

`BYPASS` varsa route tanımında bunun nedeni bulunmalıydı. `MISS` varsa oluşturulan key okunabilir
olmalıydı. `STALE` ise arka planda hangi revalidation işinin çalıştığı, retry sayısı ve lock durumu
izlenebilmeliydi.

Bu ihtiyaç bizi process-local cache’ten Redis’e, ardından iki seviyeli revalidation deduplication’a
götürdü:

- Aynı process içinde aynı key için tek revalidation Promise’i.
- Replica’lar arasında aynı key için Redis distributed lock.
- Başarısız gateway cevabında stale içeriğin korunması.
- Üstel backoff ile sınırlı retry.
- Shutdown sırasında devam eden revalidation işlerinin drain edilmesi.

Bunlar Next.js ile hiçbir biçimde yapılamaz demiyoruz. Güncel Next.js, self-hosted cache handler’ları
ve remote cache seçenekleri sunuyor. Resmî dokümantasyon self-hosted ve serverless runtime cache
davranışlarının farklı olduğunu da belirtiyor. Bizim tercihimiz, bu operasyonel modelin doğrudan
uygulama kodunda ve Redis kontratında görünür olmasıydı.

## Denediğimiz ara çözümler neden kalıcı olmadı?

Framework değiştirmek ilk kararımız değildi. Önce daha dar çözümler denedik.

### Her şeyi dynamic yapmak

Bu yaklaşım correctness açısından kolaydı. Her request yeniden render edilir, token ve cookie
değerleri güncel kalırdı. Fakat public sayfalardaki shared cache avantajını kaybediyorduk. Gateway
trafiği ve SSR maliyeti kullanıcı sayısıyla birlikte büyüyordu.

### Her şeyi static tutmak

Bu kez request-time gereksinimleri component ağacının dışına itmek gerekiyordu. Kişiselleştirme ve
auth bilgisini tamamen client’a taşımak ek request’ler, loading state’leri ve daha fazla client-side
JavaScript anlamına geliyordu. SEO veya ilk HTML’de bulunması gereken içerikler için de uygun
değildi.

### Fetch seviyesinde cache yönetmek

Tek tek veri isteklerini cache’lemek gateway yükünü azaltıyordu; fakat “bu HTML güvenle kullanıcılar
arasında paylaşılabilir mi?” sorusunu tek başına cevaplamıyordu. Data cache ile rendered HTML cache
aynı şey değildir.

### Suspense sınırlarıyla dynamic alanları ayırmak

Bu yaklaşım teknik olarak güçlüydü ve Next.js’in Partial Prerendering/Cache Components yönelimi de
aynı probleme odaklanıyor: static shell ile dynamic alanları bir arada sunmak. Güncel Next.js
dokümantasyonu Cache Components’ı tam olarak bu static shell ve dynamic content birleşimi üzerinden
anlatıyor. [Cache Components dokümantasyonu](https://nextjs.org/docs/app/getting-started/partial-prerendering)
bu alandaki güncel yaklaşımı gösteriyor.

Bizim için eksik kalan parça yalnızca render ağacındaki sınır değildi. Cache key registry’si, Redis
yaşam döngüsü, purge API’si, auth bypass, middleware sırası ve gateway proxy davranışı üzerinde de
aynı açıklığı istiyorduk. Bir noktadan sonra framework’ün modelini özelleştirmek yerine daha küçük
bir runtime üzerinde kendi kontratlarımızı kurmanın daha anlaşılır olacağına karar verdik.

## Neden Hono ve React?

Yeni bir framework yazmak istemiyorduk. İhtiyacımız olan şey küçük, standartlara yakın ve kontrol
edilebilir bir HTTP katmanıydı.

Hono bize şunları verdi:

- Web standardı `Request` ve `Response` modeli.
- Küçük ve okunabilir middleware yapısı.
- Node.js üzerinde düşük ek yükle çalışma.
- Routing ve API endpoint’leri için yeterli fakat baskın olmayan bir abstraction.

React ise zaten sunum katmanımızdı. `react-dom/server` ile tam HTML document üretmek için ayrıca bir
meta-framework zorunlu değildi.

Ortaya çıkan route kontratı bilinçli biçimde küçüktü:

```ts
type Route<T> = {
  path: string;
  loader: (ctx: Ctx) => Promise<{ data: T; status?: number }>;
  cache?: (ctx: Ctx) => CachePolicy;
  generateMetadata?: (data: T, ctx: Ctx) => PageMetadata;
  Component: (props: { data: T }) => ReactElement;
};
```

Bu kontratta önemli olan alan `cache` idi. Route cache davranışını framework’e keşfettirmiyor;
kendisinin bir özelliği olarak ilan ediyordu.

```ts
type CachePolicy =
  | { kind: "none" }
  | {
      kind: "shared";
      ttl: number;
      swr: number;
      key: string[];
    };
```

Artık route review edilirken rendering ve cache kararı aynı yerde görülebiliyordu. Bir cookie’nin
okunması route’u gizlice başka bir kategoriye taşımıyordu. Cookie gerçekten HTML’i değiştiriyorsa
cache key’ine ekleniyor veya açık bir bypass kuralı tanımlanıyordu. Değiştirmiyorsa cache kararını
etkilemiyordu.

## Bağımsız mock gateway neden bu hikâyenin parçası?

Bu proje geliştirilirken gerçek gateway henüz hazır değildi. İlk aşamada mock cevapları uygulama
service dosyalarının içinde tutmak kolay görünüyordu. Fakat bu yaklaşım önemli bir gerçeği gizliyordu:
uygulama gerçek bir network sınırından geçmiyordu.

Bu nedenle mock verileri uygulamadan çıkarıp 4002 portunda çalışan ayrı bir Node.js servisine taşıdık.
`mock-gw` bilinçli olarak basit tutuldu. Mükemmel bir backend, gerçek IAM sistemi veya production CMS
olmayı amaçlamıyor. Görevi HTTP kontratlarını gerçek request’lerle çalıştırmak:

- Menü ve sayfa içeriği
- Blog ve teklifler
- Redirect kuralları
- Login, token refresh ve profil doğrulama
- Korumalı hesap özeti
- Bot analytics sink

Uygulama artık geliştirme ortamında bile “gateway hata verirse local fixture’a düş” davranışı
taşımıyor. Gateway yoksa hata gerçekten görünür oluyor. Test suite de aynı mock gateway’i rastgele bir
portta başlatıp gerçek HTTP üzerinden doğruluyor. Gerçek gateway hazır olduğunda uygulama kodunun
değişmesi gerekmiyor; yalnızca `GATEWAY_URL` değişiyor.

Bu ayrım makalenin ana fikriyle aynı yere çıkıyor: örtük fallback yerine açık sınır.

## Ne kazandık?

En büyük kazanım birkaç milisaniye değildi. Sistem hakkında daha güçlü cümleler kurabilmeye başladık:

- Her route cache politikasını açıkça ilan eder.
- Cache key yalnızca HTML’i değiştiren normalize edilmiş girdilerden oluşur.
- Kullanıcı token’ı tek başına public route’u cache dışına çıkarmaz.
- Kişisel veri shared HTML’e girmez.
- Korumalı verinin otoritesi HttpOnly credential ve gateway’dir.
- UI cookie’leri yalnızca hızlı ilk render için doğrulanmamış ipuçlarıdır.
- Gateway `401` cevabı refresh ve tek seferlik retry akışını başlatır.
- Gateway `5xx` cevabı kullanıcıyı yanlışlıkla logout etmez.
- Redis yoksa cache miss yaşanır; replica-local cache’e sessizce düşülmez.
- Stale revalidation işleri gözlemlenebilir, deduplicate edilir ve shutdown’da drain edilir.

Bu cümlelerin her biri test edilebilir bir invariant haline geldi.

## Ne kaybettik?

Framework’ten çıkmanın romantik bir tarafı yok. Next.js’in üstlendiği birçok sorumluluk artık bize
ait:

- Client ve server build’lerini yönetmek
- Island bootstrap ve hydration kodunu sürdürmek
- Metadata ve document rendering kurallarını yazmak
- Cache invalidation ve purge operasyonlarını tasarlamak
- Security header, CSP ve proxy sınırlarını korumak
- Health, readiness, metrics ve graceful shutdown uygulamak
- Framework güncellemeleriyle otomatik gelen optimizasyonları kendimiz değerlendirmek

Bu maliyet ancak ihtiyaç duyulan kontrol gerçekten ürün için önemliyse anlamlıdır. Küçük bir ekip,
standart bir içerik sitesi veya Next.js’in doğal rendering modeline uyan bir uygulama için bu geçiş
gereksiz olabilir.

## Güncel uygulama notu: framework’ten çıkınca media optimizasyonu da kontrata dönüşür

Next.js’ten ayrılmak `next/image` ve `next/font` sonuçlarından vazgeçmek anlamına gelmiyor; yalnız bu
sonuçların sorumlusu artık açıkça biziz. Güncel uygulamada responsive görseller build sırasında Sharp
ile AVIF/WebP/JPEG varyantlarına ayrılıyor, LCP adayı route kontratından preload ediliyor ve Inter
variable font Latin/Latin Extended subsetleriyle self-host ediliyor.

Burada özellikle iki CDN davranışını ayırdık. `IMAGE_CDN_URL`, halihazırda optimize edilmiş veya
dönüştürülmesini istemediğimiz dosyalar için doğrudan prefix’tir; `UnoptimizedImage` tek `src` üretir.
Gerçek bir responsive transformation servisi varsa bunun endpoint’i `IMAGE_TRANSFORM_URL` ile ayrıca
verilir. Böylece “CDN kullanıyorum” bilgisi, örtük biçimde “runtime dönüşüm istiyorum” kararına
dönüşmez. `/medya-pipeline` sayfası iki yolu ve self-host fontları çalışan HTML üzerinde gösterir.

## Güncel uygulama notu: `__NEXT_DATA__` deneyiminden embedded JSON kontratına

Next.js döneminde yalnız rendering ve cache kararlarıyla değil, document source içindeki veri
yüzeyiyle de uğraştık. `__NEXT_DATA__` payload'ında `/kategori`, `/arama?...` veya `https://...` gibi
route-benzeri string'ler gerçek anchor olmasalar bile crawler-visible HTML'in parçasıydı. Büyük URL
envanterinde bu tekrarları crawler'ın yorumuna bırakmak yerine yalnız bizim ürettiğimiz semantik
`<a href>` linklerinin keşif otoritesi olmasını istedik.

Yeni runtime'da aynı risk island `data-props` alanında yeniden oluşabilirdi. Bu yüzden çözüm component
bazlı değil, document serialization kontratı oldu: HTML'e gömülen JSON `serializeEmbeddedJson()` ile
üretiliyor ve bütün `/` karakterleri JSON'un geçerli `\/` solidus escape'ine dönüştürülüyor. Client
`JSON.parse` ile okuduğunda değer tekrar normal slash oluyor; gerçek link, canonical, sitemap, API
response veya Redis verisi değişmiyor.

Google gerçek crawlable link için `<a href>` biçimini öneriyor; ayrıca gereksiz ve duplicate URL
envanterinin crawl kaynaklarını tüketebileceğini belirtiyor. Buradaki escape katmanı robots veya
canonical yerine geçmiyor. Amacı link olmayan hydration verisini gerçek link envanterinden fiziksel
olarak ayırmak.

## Ölçüm: aynı sayfada Next.js App Router ile ssr-kit

Karar sürecini yalnızca mimari argümanlarla bırakmadık. `nextjs-overhead-poc/` altında Next.js 16 App
Router ile aynı mock gateway’e bağlı bir karşılaştırma projesi kurduk: `/blogs/paginated` sayfası,
kopyalanmış header/footer, layout’ta User-Agent ile cihaz tespiti ve menü SSR, page’de `page` query
parametresi ile blog listesi fetch’i.

`npm run bench:compare` ile çalışan `scripts/bench/compare-next.mjs` (autocannon, 50 bağlantı, 15 saniye) yerel koşulda şu sonucu verdi:

|                | ssr-kit `:3005` | Next.js POC `:3006` |
| -------------- | --------------- | ------------------- |
| RPS (ort.)     | ~1.972          | ~20                 |
| Gecikme (ort.) | ~25 ms          | ~2.227 ms           |

Bu tablo “Next.js kötü” demek değildir. ssr-kit tarafında route **shared HTML cache HIT** ağırlıklı
çalışırken Next POC bilinçli olarak **cache’siz full SSR + layout/page başına gateway fetch** ile
bırakıldı. Farkın büyük bölümü framework değil, **route cache kontratının varlığı** ile açıklanır.

Ölçüm kurulumu, asimetri uyarıları ve önerilen ek senaryolar:
[06 — Aynı Sayfada Next.js ve ssr-kit: Blog Paginated Yük Testi](./06-ayni-sayfada-nextjs-ve-ssr-kit-yuk-testi.md).

## Her proje Next.js’ten çıkmalı mı?

Hayır.

Şu koşullarda Next.js’te kalmak çoğu zaman daha doğru karardır:

- Ekip framework convention’larıyla verimli çalışıyorsa.
- Hosting ve cache modeli ürünün operasyonel ihtiyaçlarını karşılıyorsa.
- Route’ların static/dynamic sınırları kolayca anlaşılabiliyorsa.
- Kişiselleştirme Suspense, Cache Components veya client-side alanlarla temiz biçimde ayrılabiliyorsa.
- Özel Redis cache, purge veya gateway pipeline’ı işletmek istemiyorsanız.

Framework’ten çıkmak bir olgunluk göstergesi değildir. Bazen tam tersine, gereksiz altyapı sahipliği
yaratır. Bizim için doğru olmasının nedeni, rendering ve cache kararlarının ürünün merkezinde yer
almasıydı.

## Sonuç: Dynamic rendering değil, örtük kararlar bizi uzaklaştırdı

Next.js’ten ayrılma nedenimizi tek cümlede anlatmamız gerekirse şöyle söyleriz:

> Dynamic rendering istemediğimiz için değil; hangi request’in neden dynamic olduğunu, hangi
> girdinin cache’i böldüğünü ve kişiselleştirmenin shared HTML’i nerede terk ettiğini kendi
> kontratlarımızla ifade etmek istediğimiz için ayrıldık.

Hono ve React bize sihirli bir performans kazancı vermedi. Bize kararların yerini değiştirme imkânı
verdi. Rendering, cache, auth ve gateway davranışları framework’ün component ağacından çıkıp route ve
request pipeline kontratlarına taşındı.

Bu değişiklikle sistem daha küçük olmadı; fakat daha açıklanabilir hale geldi. Bizim için uzun vadeli
değer tam olarak buydu.

Serinin bir sonraki yazısında bir request’in Hono’ya girişinden React HTML response’una dönüşmesine
kadar geçen bütün yolu inceleyeceğiz: middleware pipeline, redirect/rewrite/proxy sırası, loader
kontratı, metadata üretimi ve full-document SSR.

---

## Kaynaklar

- [06 — Aynı Sayfada Next.js ve ssr-kit: Blog Paginated Yük Testi](./06-ayni-sayfada-nextjs-ve-ssr-kit-yuk-testi.md)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Partial Prerendering](https://nextjs.org/docs/canary/app/building-your-application/rendering/partial-prerendering)
- [Next.js Cache Components](https://nextjs.org/docs/app/getting-started/partial-prerendering)
- [Next.js `use cache` directive](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- [Next.js caching — previous model](https://nextjs.org/docs/app/guides/caching-without-cache-components)
- [Google crawlable link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
- [Google crawl budget management](https://developers.google.com/crawling/docs/crawl-budget)
- [RFC 8259 — JSON solidus escape](https://www.rfc-editor.org/rfc/rfc8259)
