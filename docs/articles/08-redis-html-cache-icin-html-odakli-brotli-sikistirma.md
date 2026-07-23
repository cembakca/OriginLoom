# Redis HTML Cache’i İçin HTML-Odaklı Brotli Sıkıştırma

> Amaç bir dictionary bakım sistemi kurmak değil; Redis L2'ye yazılan tam HTML document’ini güçlü biçimde
> küçültüp L1 miss sonrası L2 hit’inde aynı baytları güvenle geri üretmek. Sıcak L1 hit’te Redis okunmaz.

SSR cache’inde binlerce HTML document tutulduğunda Redis belleğinin büyük kısmını body değerleri
kullanır. Bu projede sıkıştırma Redis’in içinde değil, uygulama ile Redis arasındaki codec sınırında
yapılır:

```text
SSR HTML string
  → HTML olduğunu doğrula
  → Brotli TEXT mode ile sıkıştır
  → binary Buffer olarak Redis SET

Redis GET Buffer
  → formatı ve encoding'i doğrula
  → Brotli ile aç
  → UTF-8'i strict decode et
  → orijinal HTML string
```

Bu tasarım dictionary üretimi, route örnekleme script’i veya deploy’lar arası dictionary
koordinasyonu gerektirmez.

## Neden varsayılan/generic sıkıştırma değil?

`RedisStore` yalnız HTML sayfaları için kullanılmıyor. Menü ve route-domain gibi küçük JSON değerleri
de aynı cache interface’inden geçebiliyor. Her string’i aynı algoritmayla sıkıştırmak küçük payload’da
header ve CPU maliyetini artırabilir.

Codec bu nedenle üç karar verir:

1. Body tam HTML document’i mi?
2. UTF-8 boyutu en az 1 KiB mı?
3. Sıkıştırılmış çıktı gerçekten raw body’den küçük mü?

Bu koşullardan biri sağlanmazsa değer raw UTF-8 olarak saklanır. Dolayısıyla sistem “Redis’e giren her
şeyi sıkıştır” gibi genelgeçer bir politika uygulamaz; yalnız hedeflenen HTML body’lerini optimize eder.

HTML tespiti başlangıç kontratına dayanır:

```text
<!DOCTYPE html...
<html...
```

Fragment, JSON, lock token ve service cache payload’ları Brotli yoluna girmez.

## Neden Brotli?

Brotli web metinlerinde yüksek oran için tasarlanmış yerleşik bir static dictionary ve UTF-8 text
mode’u sunar. Uygulamanın ayrıca dictionary üretmesi gerekmez.

Node.js 22.17 `node:zlib` API’sindeki parametreler HTML için açıkça ayarlanır:

```ts
brotliCompressSync(raw, {
  params: {
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    [constants.BROTLI_PARAM_QUALITY]: 8,
    [constants.BROTLI_PARAM_LGWIN]: 19,
    [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  },
});
```

- `BROTLI_MODE_TEXT`: Encoder’ı UTF-8 text için ayarlar; generic mode kullanılmaz.
- Quality `8`: Yüksek oran hedefler fakat quality 11’in cold-fill CPU maliyetine çıkmaz.
- Window `19`: 512 KiB pencere, bu projenin onlarca KiB’lık HTML document’lerinin tamamındaki tekrarları
  görebilir.
- `SIZE_HINT`: Encoder gerçek input boyutunu önceden bilir.

Compression cold fill ve revalidation write yolunda bir kez çalışır. Decompression ise her Redis
hit’inde çalıştığı için Brotli’nin hızlı decode karakteri önemlidir.

## Wire format

Redis value tek bir binary frame’dir:

```text
[4 byte magic: SSRC]
[1 byte format version]
[1 byte encoding: raw | brotli-html]
[8 byte freshUntil]
[8 byte staleUntil]
[payload]
```

Magic ve version, rastgele/legacy bir değerin yeni frame gibi yorumlanmasını engeller. Encoding byte’ı
JSON gibi raw değer ile Brotli HTML’i ayırır. Cache state için gereken timestamp’ler JSON metadata
yerine sabit genişlikte tutulur.

```ts
const MAGIC = Buffer.from("SSRC");
const FORMAT_VERSION = 1;
const ENCODING_RAW = 0;
const ENCODING_BROTLI_HTML = 1;
```

Decode sırasında şunlar doğrulanır:

- Minimum header boyutu
- Magic ve format version
- Bilinen encoding
- Timestamp’lerin safe integer olması
- `staleUntil >= freshUntil`
- Payload’ın strict UTF-8 olarak açılabilmesi

Brotli corruption, bilinmeyen encoding veya malformed timestamp cache miss üretir. Bozuk içerik HTML
olarak servis edilmez.

## Sıkıştırma hata verirse ne olur?

Cache optimizasyonu request’in doğruluğunu ele geçirmemelidir. Brotli compression beklenmedik biçimde
hata verirse codec raw UTF-8 encoding’e düşer. Redis write devam eder ve HTML kaybolmaz.

```text
Brotli success + daha küçük → brotli-html
Brotli success + daha büyük → raw
Brotli error                → raw
```

Decode hatasında raw fallback yapılamaz; payload’ın nasıl üretildiği bilinmez. Bu durumda entry miss
kabul edilir ve Redis key’i silinir. Sonraki request normal loader/render akışıyla doğru HTML’i yeniden
üretir.

## Eski JSON cache kayıtları

Önceki `RedisStore` değerleri şu şekilde yazıyordu:

```json
{
  "body": "<!DOCTYPE html>...",
  "freshUntil": 1800000000000,
  "staleUntil": 1800000060000
}
```

Yeni decoder geçiş süresince bu legacy JSON formatını da okuyabilir. Geçerli kayıt silinmez ve mevcut
Redis TTL’i dolana kadar HIT/STALE üretmeye devam eder. Yeni write’lar binary frame kullanır; böylece
rolling deploy toplu cache invalidation yaratmaz.

Legacy decoder kalıcı yeni write formatı değildir. Eski kayıtların maksimum TTL/SWR süresi geçtikten
sonra kaldırılabilir.

## ioredis neden `getBuffer()` kullanıyor?

Brotli payload rastgele binary byte’lar içerir. Normal `get()` cevabı UTF-8 string’e dönüştürür ve
geçersiz UTF-8 dizilerini bozabilir. Bu nedenle okuma binary-safe olmak zorundadır:

```ts
const raw = await redis.getBuffer(key);
const entry = decodeCacheEntry(raw);
```

Redis `SET` zaten Buffer kabul eder. Base64 kullanılmaz; base64 değeri yaklaşık üçte bir büyütüp
sıkıştırma kazancını azaltır.

## Ne kazandırıyor?

Kazanç HTML’in gerçek içeriğine bağlıdır. Shared shell, utility class’ları, metadata ve tekrarlanan
component markup’ı yüksek olan document’ler Brotli’den güçlü fayda görür. Benzersiz uzun metin içeren
sayfalarda oran daha düşük olabilir.

Codec belirli bir yüzdeyi garanti etmez. Bunun yerine güvenli bir invariant uygular:

> Sıkıştırılmış payload raw HTML’den küçük değilse sıkıştırılmış biçim Redis’e yazılmaz.

Dolayısıyla compression framing dışında body storage açısından negatif kazanç kabul edilmez. Küçük
JSON değerleri de raw kaldığı için HTML optimizasyonu diğer cache kullanım alanlarına yayılmaz.

Production değerlendirmesinde şunlar ölçülmelidir:

- Raw HTML byte / Redis value byte oranı
- Compression süresi (cold fill ve revalidation)
- Decompression süresi (HIT)
- Decode failure sayısı
- Process CPU ve event-loop lag
- Redis `used_memory_dataset` ve eviction oranı

Quality artırmak yalnız Redis byte’ını düşürüyorsa değil, toplam CPU/memory maliyetini iyileştiriyorsa
doğrudur.

### Canlı event stream bu codec'in konusu değildir

`text/event-stream` uzun yaşayan bir taşıma kanalıdır; tamamlanmış bir HTML document değildir. Quote
event'lerini biriktirip Brotli frame olarak Redis'e yazmak hem latency'yi artırır hem de sınırsız bir
body üretir. BIST route'unda yalnız ilk SSR snapshot'ı normal HTML cache codec'inden geçer; hydration
sonrasındaki SSE response `private, no-store, no-transform` taşır ve Redis body cache'ine girmez.

Bu ayrım ingress için de önemlidir. HTML cache compression storage optimizasyonudur; SSE'deki
`no-transform` ise ara proxy'nin event'leri sıkıştırmak için buffer etmemesi gereken transport
kontratıdır. Aynı “compression” kelimesi iki farklı katmanı ifade eder.

## Neden uygulamaya özel dictionary yok?

Uygulama tarafından üretilen dictionary daha yüksek oran verebilir; fakat beraberinde şu lifecycle’ı
getirir:

- Temsili route ve query seçimi
- Dictionary regeneration
- CI freshness kontrolü
- Dictionary fingerprint ve cache namespace koordinasyonu
- Rolling deploy ve rollback uyumluluğu
- Training örneklerinin production’ı temsil edip etmediğinin ölçümü

Bu proje için amaç maksimum teorik oran değil, güçlü ve düşük bakım maliyetli Redis optimizasyonudur.
Brotli’nin yerleşik web-text dictionary’si ve `TEXT` mode’u bu dengeyi ayrı artifact üretmeden sağlar.

Dictionary ancak gerçek production ölçümleri plain HTML-tuned Brotli’nin Redis bütçesini
karşılamadığını gösterirse yeniden değerlendirilmelidir.

## Sonuç

Yeni kontrat basittir:

- Yalnız tam HTML document’leri sıkıştır.
- Brotli’yi generic defaults ile değil text/quality/window/size parametreleriyle ayarla.
- Küçük veya kazanç sağlamayan payload’ı raw bırak.
- Redis binary değerini `getBuffer()` ile oku.
- Her decode sonunda orijinal UTF-8 HTML’i üret.
- Legacy JSON’u TTL süresince güvenle destekle.
- Dictionary ve manuel regeneration sürecini uygulamadan çıkar.

Bu yaklaşım Redis belleğini anlamlı ölçüde azaltırken cache correctness’i ayrı bir operasyonel
artifact’e bağlamaz.

---

## Kaynaklar

- [Node.js 22.17 zlib/Brotli API](https://nodejs.org/docs/latest-v22.x/api/zlib.html)
- [RFC 7932 — Brotli Compressed Data Format](https://www.rfc-editor.org/rfc/rfc7932)
- [Cache Bir Optimizasyon Değil, Route Kontratıdır](./03-cache-bir-optimizasyon-degil-route-kontratidir.md)
- [SSR Snapshot ile Güvenli Canlı Piyasa Verisi](./13-ssr-snapshot-ile-guvenli-canli-piyasa-verisi.md)
