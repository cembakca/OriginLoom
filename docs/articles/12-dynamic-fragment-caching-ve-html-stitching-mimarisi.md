# 12. Dinamik Fragment Cache ve Buffered HTML Stitching

Tam sayfa HTML cache’i yüksek hit oranı sağlar; fakat header/footer gibi global alanların freshness
süresini bütün sayfayla aynı kontrata bağlar. Fragment cache bu alanları ve pahalı public widget’ları
ayrı key/TTL sözleşmeleriyle saklar.

Bu implementasyonun sınırı önemlidir:

> Stitching, tamamı buffer edilmiş HTML string üzerinde çalışır. React streaming response body’sini
> dönüştürmez.

Gerçek streaming route’lar mevcut server-rendered fallback’i gönderir. Fragment cache kullanılacak
route buffered render üretmelidir.

## İki kullanım biçimi

### Cached document üzerinde shell yenileme

Shared page cache’inden gelen HTML header/footer placeholder’larını içerir:

```html
<ssr-fragment name="header" style="display:contents">
  <!-- page render zamanındaki public header -->
</ssr-fragment>
```

Cache HIT/STALE sırasında handler güncel shell verisini çözer. Header/footer key’i şunlardan oluşur:

```text
fragment adı + device type + menu content fingerprint
```

Menü payload’ı değiştiğinde fingerprint de değişir. Eski fragment Redis’te TTL sonuna kadar dursa bile
artık okunmaz; yeni menü yeni key’den render edilir. Purge endpoint’i eski header/footer prefix’lerini
temizleyerek belleği erken boşaltabilir fakat correctness yalnız purge webhook’una bağlı değildir.

### Katalog sayfasında bağımsız public widget cache

`/bilgi-merkezi` document cache kullanırken popüler rehberler daha kısa bir freshness bütçesine
sahiptir:

```text
GET /bilgi-merkezi
  → Bilgi Merkezi loader + buffered SSR render/cache lookup
  → <ssr-fragment name="popular-knowledge-articles"> bulunur
  → fragment:popular-knowledge-articles:v1
      HIT  → L1 (sıcak) veya L2 promote
      MISS → GET /content/articles/popular + React fragment render + L1/L2 write
  → tamamlanmış HTML response
```

Document TTL'i ile popüler widget TTL'i birbirinden bağımsızdır. Page HIT olsa bile stitching response
kopyasında çalışır ve widget beş dakika boyunca gateway'e tekrar gitmez.
“HIT 0 ms” garantisi yoktur: L2 miss path’te network ve decode süresi devam eder; sıcak L1 hit’te
yalnızca bellek okunur. Garanti, fragment HIT’inde widget gateway çağrısının ve React fragment
render’ının atlanmasıdır.

## Fragment kontratı

Registry’de her fragment yalnız resolver değil, bütün cache sözleşmesini tanımlar:

```ts
type FragmentDefinition = {
  requiresShell: boolean;
  resolveOnFreshDocument: boolean;
  ttl: number;
  key: (shell: ShellData | null, ctx: Ctx) => string;
  resolve: (shell: ShellData | null, ctx: Ctx) => Promise<ReactElement> | ReactElement;
};
```

Alanların anlamı:

- `key`: HTML’i değiştiren bütün public varyasyonları içerir.
- `ttl`: Fragment’ın kendi freshness bütçesidir.
- `requiresShell`: Resolver’ın menu/device shell verisine ihtiyacını açıklar.
- `resolveOnFreshDocument`: Fresh page render’daki mevcut SSR içeriğinin ayrıca değiştirilip
  değiştirilmeyeceğini söyler.
- `resolve`: Request signal’ını `ctx.request.signal` üzerinden gateway’e taşıyan public resolver’dır.

Kullanıcı ID’si, auth token veya kişisel payload shared fragment’a giremez. Kişisel fragment
gerekiyorsa shared Redis cache değil, island/BFF veya cache-bypass SSR kullanılmalıdır.

## Key tasarımı

Tek bir `fragment:{name}:{device}` şablonu bütün fragment’lar için yeterli değildir.

Header/footer:

```text
fragment:header:Desktop:{menuFingerprint}
fragment:footer:Mobile:{menuFingerprint}
```

Popüler Bilgi Merkezi rehberleri:

```text
fragment:popular-knowledge-articles:v1
```

Popular widget mevcut kontratta device, route, query veya auth’a göre değişmediği için bunlar key’e
eklenmez. Gelecekte locale veya market HTML’i değiştirirse resolver eklenmeden önce bu değerler key’e
alınmalıdır.

## Fresh render ve cache HIT farkı

Fresh MISS/BYPASS document zaten güncel shell ile render edilir. Bu response’ta header/footer’ı tekrar
render etmek ikinci menu cache lookup’ı ve gereksiz React işi oluşturur. Bu nedenle:

```text
Fresh MISS/BYPASS:
  header/footer → mevcut SSR çıktısı korunur
  popüler rehberler → fragment cache ile çözülür

Page HIT/STALE:
  header/footer → güncel fingerprint key’iyle çözülür
  popüler rehberler → fragment cache ile çözülür
```

Page cache’e yazılan body placeholder’ları korur; stitching response kopyasında yapılır. Böylece
sonraki HIT güncel fragment’ı yeniden seçebilir.

## Cold MISS coalescing

Aynı fragment key’ine eşzamanlı MISS geldiğinde her request’in gateway ve render çalıştırması stampede
oluşturur. Fragment fill mevcut `coalesceColdMiss()` altyapısını kullanır:

```text
process içi Promise dedup
  → L2 varsa Redis distributed lock; yoksa process-local lock
  → cache race check
  → tek resolver/render/write
  → diğer request’ler sonucu bekler
```

Request beklerken abort/deadline signal’ı izlenir. Asenkron resolver da aynı signal’ı gateway fetch’e
taşır.

## Hata davranışı

Her fragment bağımsız çözülür. Bir widget hata verdiğinde diğer header/footer sonuçları kaybedilmez;
hatalı fragment server-rendered fallback’iyle kalır.

Request deadline farklıdır. Deadline hatası fallback’e çevrilip `200` dönmez; handler’a yeniden
fırlatılır ve standart timeout kontratı korunur.

```text
resolver/gateway normal hata → ilgili fallback + log
request deadline             → rethrow
```

Fallback browser’da “fragment yüklenirken gösterilen skeleton” değildir. Stitching response
gönderilmeden önce tamamlanır. Fallback yalnız resolver başarısız olduğunda veya fragment desteklenmeyen
streaming yolda server çıktısı olarak kalır.

## HTML güven sınırı

Fragment HTML’i arbitrary string callback’inden gelmez. Resolver bir React element döndürür ve
`renderToString()` gateway metinlerini escape eder. Fragment adı kapalı registry’den ve
`[a-zA-Z0-9_-]+` marker formatından gelir.

Regex parser genel amaçlı HTML parser değildir; yalnız uygulamanın kendi `RootLayout`/route render’ının
ürettiği kontrollü marker’ları işler. Dışarıdan alınmış ham HTML üzerinde kullanılmamalıdır.

## Streaming ve CSP

React `renderToPipeableStream()` Suspense boundary’lerini açmak için inline runtime script’leri
üretebilir. Script metni/boundary ID’si değişebildiğinden sabit hash listesi güvenilir değildir.

Security middleware her response için rastgele CSP nonce üretir:

```text
Content-Security-Policy: script-src ... 'nonce-{requestNonce}'
```

Aynı nonce route context üzerinden React stream renderer’a verilir; React’in ürettiği runtime script
tag’ları nonce taşır. Static analytics script’leri mevcut sabit hash kontratını kullanmaya devam eder.

## Purge ve freshness

| Fragment          | Key varyasyonu            |      TTL | Purge                                  |
| ----------------- | ------------------------- | -------: | -------------------------------------- |
| Header            | device + menu fingerprint | menu TTL | `fragment:header:`                     |
| Footer            | device + menu fingerprint | menu TTL | `fragment:footer:`                     |
| Popüler rehberler | sabit public `v1`         | 5 dakika | `fragment:popular-knowledge-articles:` |

Menu purge header/footer’ı da temizler. Ancak menu fingerprint correctness’i purge çağrısından bağımsız
hale getirir. Widget verisi TTL sonunda doğal MISS ile yenilenir; acil içerik kaldırma için prefix purge
kullanılabilir.

## Yeni fragment checklist’i

1. HTML tamamen public ve shared mı?
2. Çıktıyı değiştiren locale/device/market/path/query değerlerinin tamamı key’de mi?
3. TTL ürün freshness beklentisine uygun mu?
4. Resolver `ctx.request.signal` değerini bütün I/O’ya taşıyor mu?
5. Normal hata için güvenli SSR fallback var mı?
6. Request deadline yeniden fırlatılıyor mu?
7. Eşzamanlı MISS coalesce ediliyor mu?
8. Streaming route’ta kullanılmayacağı açık mı?
9. Prefix purge operasyonu tanımlı mı?
10. HIT, MISS, abort, key varyasyonu ve purge testleri var mı?

## Her değişken widget fragment cache olmamalı

Fragment cache, yenilenme aralığı saniye/dakika ölçeğinde olan public widget'larda gateway ve React
render maliyetini paylaşır. Saniyede birden çok kez değişen fiyat tablosu için aynı desen doğru
değildir. Her quote batch'inde fragment purge/fill yapmak Redis write amplification, lock yarışı ve
gereksiz HTML serialization üretir.

BIST ekranı bu nedenle ikiye ayrılır: crawlable ilk tablo route snapshot'ından SSR edilir, sonraki
fiyatlar `market-live` island'ına SSE ile taşınır. Akış yoksa snapshot fallback olarak kalır. Fragment
cache'i “dinamik görünen her şeyi Redis'e koyma” aracı değil; bounded freshness'e sahip public HTML
parçalarının kontratıdır.

## Sonuç

Fragment cache’in faydası yalnız daha küçük invalidation değildir. Her public HTML parçasına açık bir
key, TTL, dependency ve failure kontratı verir.

Bu sistemde:

- page cache body’si yeniden kullanılabilir placeholder taşır,
- fresh render gereksiz shell stitching yapmaz,
- cached document güncel menu fingerprint’ini kullanır,
- public widget kısa TTL ile gateway maliyetini azaltır,
- cold MISS process ve pod’lar arasında coalesce edilir,
- deadline ve CSP güvenlik kontratları korunur.

Bu sınırlar olmadan registry’ye “tek resolver satırı eklemek” kolay görünür fakat cache izolasyonu ve
freshness hatalarını gizler.

Canlı ve yüksek frekanslı veri sınırı için
[SSR Snapshot ile Güvenli Canlı Piyasa Verisi](./13-ssr-snapshot-ile-guvenli-canli-piyasa-verisi.md)
yazısına bakın.
