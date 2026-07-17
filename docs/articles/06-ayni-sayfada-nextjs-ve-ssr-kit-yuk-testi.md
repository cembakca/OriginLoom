# Aynı Sayfada Next.js ve ssr-kit: Blog Paginated Yük Testi

> `nextjs-overhead-poc` ile aynı gateway, aynı UI ve aynı URL üzerinde autocannon ölçümünün yorumu

Bu yazı “Next.js yavaştır” iddiası taşımaz. Yerel makinede, kontrollü ama **asimetrik** bir
karşılaştırmada ne ölçtüğümüzü, sayıların ne anlama geldiğini ve neyi kanıtlamadığını netleştirir.

Serinin birinci yazısı ([Dynamic Rendering Bizi Neden Next.js’ten Uzaklaştırdı?](./01-dynamic-rendering-bizi-neden-nextjsten-uzaklastirdi.md))
framework karar modeliyle operasyonel ihtiyaç arasındaki uyumsuzluğu anlatıyordu. Bu yazı aynı
motivasyonun **ölçülebilir bir yüzünü** gösterir: explicit route cache ile App Router SSR’ın aynı
sayfada nasıl ayrıştığı.

## Ne yaptık?

Karşılaştırmayı adil olabildiğince **aynı ürün yüzeyine** indirdik. Repoda `nextjs-overhead-poc/`
adlı bağımsız bir Next.js 16 (App Router) projesi oluşturduk.

### Ortak koşullar

| Parça       | ssr-kit                                          | nextjs-overhead-poc                            |
| ----------- | ------------------------------------------------ | ---------------------------------------------- |
| URL         | `http://localhost:3005/blogs/paginated?page=2`   | `http://localhost:3006/blogs/paginated?page=2` |
| Gateway     | Aynı `GATEWAY_URL` (mock-gw `:4002`)             | Aynı                                           |
| Sayfa       | Blog listesi + pagination                        | Aynı UI bileşenleri kopyalandı                 |
| Layout      | Header / Footer SSR                              | Aynı component’ler (Island’sız)                |
| Cihaz       | User-Agent → Desktop / Tablet / Mobile           | Layout’ta `headers()` ile aynı kural           |
| Menü        | `GET /pages/menuitem/list` + `device` header     | Layout’ta native `fetch`, SSR                  |
| Blog verisi | `GET /blogs?page=2&pageSize=6&orderBy=date-desc` | Page’de native `fetch`, SSR                    |
| Query       | `page` param, redirect / 404 kuralları           | ssr-kit ile aynı `resolvePageParam` mantığı    |

Kasıtlı sadeleştirmeler:

- Next tarafında ağır gateway payload doğrulaması yok — düz `fetch` + `json()`.
- ssr-kit’teki client island (sıralama, TanStack Query) yok; SSR shell ile aynı görünüm.
- Island’lar (`user-chrome`, `mobile-menu`) statik HTML fallback.

Amaç: “framework overhead” değil, **aynı gateway ve aynı HTML kontratı** altında origin davranışını
görmek.

### Yük testi aracı

Kök dizindeki `test.js`, [autocannon](https://github.com/mcollina/autocannon) kullanır:

```javascript
autocannon({
  url: test.url,
  connections: 50,
  duration: 15,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/134.0.0.0",
  },
});
```

Her senaryo 15 saniye, 50 eşzamanlı bağlantı, aralarında 10 saniye bekleme. Ölçülen metrikler:
ortalama RPS (istek/saniye) ve ortalama gecikme (ms). Hata sayısı ayrı raporlanır.

## Ölçüm sonuçları

Yerel koşulda (macOS, mock gateway, iki uygulama aynı anda ayakta) tek koşuda elde edilen sonuçlar:

| Senaryo                      | RPS (ort.)   | Gecikme (ort.)  | Hata |
| ---------------------------- | ------------ | --------------- | ---- |
| **1. ssr-kit** (`:3005`)     | **1.971,87** | **24,86 ms**    | 0    |
| **2. Next.js POC** (`:3006`) | **20,27**    | **2.227,47 ms** | 0    |

Kabaca **~97× RPS** ve **~90× gecikme** farkı. Her iki tarafta da HTTP hata sayısı sıfır — karşılaştırma
geçerli istekler üzerinden yapılmış.

## Bu sayılar ne anlama geliyor?

### 1. En büyük fark cache asimetrisi

Bu farkın büyük bölümü “React vs Next” değil, **route cache varlığı / yokluğu**.

ssr-kit’te `/blogs/paginated?page=2` geçerli bir `page` parametresiyle **shared HTML cache** kullanır
(`PageCacheId.blogsPaginated`). Autocannon 15 saniye boyunca aynı URL’ye vurduğunda:

1. İlk istek(ler) MISS — loader çalışır, gateway’den blog çekilir, React render, memory’e yazılır.
2. Sonraki isteklerin büyük çoğunluğu **HIT** — gateway ve loader atlanır; yanıt cache’ten gelir.

Ortalama ~25 ms, tipik bir **ısınmış cache HIT** profiline uyuyor.

Next.js POC’de ise hem layout hem page fetch’leri `cache: "no-store"` ile tanımlı. HTML cache,
`unstable_cache` veya ISR yok. **Her istek**:

1. Layout SSR → menü için gateway round-trip
2. Page SSR → blog listesi için gateway round-trip
3. React Server Components render pipeline

Ortalama ~2,2 saniye, 50 eşzamanlı bağlantı altında **her seferinde tam SSR + iki upstream çağrı**
beklentisiyle uyumlu (gateway ve CPU doygunluğu).

Yani tablo büyük ölçüde şunu ölçüyor:

> **Cache HIT ile servis edilen explicit route** vs **cache’siz full SSR + çift gateway fetch**

Bu, birinci seri yazısındaki tezle örtüşür: cache bir optimizasyon süsü değil, route kontratının
parçasıdır ([03 — Cache bir optimizasyon değil, route kontratıdır](./03-cache-bir-optimizasyon-degil-route-kontratidir.md)).

### 2. Layout’ta menü = her istekte sabit maliyet

Her iki tarafta da header/footer menüsü SSR ile dolduruluyor. ssr-kit menüyü ayrıca **Redis/memory
menu cache** ile tutar (`menuCacheKey(device)`); blog sayfası HTML cache HIT olsa bile menü cache’i
layout render yolunda devreye girebilir — fakat blog HTML HIT’inde layout zaten cache’lenmiş gövdeyle
gelir, bu yüzden menü fetch’i tekrarlanmaz.

Next.js POC’de layout her istekte yeniden çalıştığı için menü fetch’i **istek başına** tekrarlanır.
Bu, App Router’ın doğal modelidir; cache eklemedikçe layout maliyeti sıfırlanmaz.

### 3. Development modu Next tarafını ağırlaştırabilir

POC varsayılan olarak `next dev` (`:3006`) ile koşturuldu. ssr-kit tarafı `npm run dev` (tsx watch +
memory cache). Next development modunda Turbopack derleme, RSC pipeline ve hot-reload altyapısı
production `next start`’a göre daha ağır olabilir.

Bu nedenle **mutlak 2,2 saniye** rakamını production SLA olarak okumamak gerekir. Önemli olan
**göreli asimetri**: aynı koşulda ssr-kit tarafının cache sayesinde binlerce RPS bandına çıkabilmesi.

### 4. Gateway mock olduğu için tavan yüksek

Mock gateway yerel Node HTTP; gerçek IAM/CMS gecikmesi yok. Gerçek ortamda her iki tarafın mutlak
gecikmesi artar; **oransal cache faydası** genelde korunur, hatta upstream pahalılaştıkça artar.

## Ne kanıtlıyor, ne kanıtlamıyor?

### Kanıtlıyor (bu kurulumda)

- Explicit HTML cache ile aynı anonim sayfa, yerelde **~2.000 RPS / ~25 ms** bandına yaklaşabilir
  (memory backend, HIT ağırlıklı).
- Cache’siz, layout+page çift fetch’li Next.js POC aynı URL’de **~20 RPS / ~2,2 s** bandında kalır.
- Route kontratına cache yazmak, framework seçiminden bağımsız olarak origin yükünü dramatik
  düşürür.
- Karşılaştırma için **aynı UI + aynı gateway** yeterli; fark davranış katmanında okunabilir.

### Kanıtlamıyor

- “Next.js production’da her zaman 97× yavaştır.”
- “Hono her zaman Next’ten hızlıdır.”
- SEO, DX veya ekip verimliliği karşılaştırması.
- CDN / edge cache katmanı dahil uçtan uca latency.
- Next.js tarafında `fetch` cache, `unstable_cache`, ISR veya `use cache` ile aynı politikanın
  uygulanamayacağı.

## Daha adil bir sonraki ölçüm

Sonuçları tartışmak için önerilen ek senaryolar:

| #   | ssr-kit                              | Next.js POC                                     | Amaç                  |
| --- | ------------------------------------ | ----------------------------------------------- | --------------------- |
| A   | Cache açık (mevcut)                  | `unstable_cache` / fetch cache ile menü + sayfa | Cache simetrisi       |
| B   | `neverCache()` veya cache bypass     | `cache: "no-store"` (mevcut)                    | Soğuk SSR eşleşmesi   |
| C   | `npm run start` (prod bundle)        | `next build && next start`                      | Dev overhead çıkarımı |
| D   | Tek istek latency (autocannon değil) | Aynı                                            | P50/P99 dağılımı      |

Özellikle **B senaryosu** “framework overhead” sorusuna daha yakın cevap verir; mevcut koşul ise
**ürün kontratı (cache’li route)** sorusuna yakındır.

## Sonuç

Autocannon çıktısı şunu söylüyor: `/blogs/paginated?page=2` için ssr-kit, ısınmış memory cache ile
saniyede yaklaşık **2.000** isteği ~**25 ms** ortalama gecikmeyle taşıyabiliyor. Aynı gateway ve
benzer HTML üreten Next.js POC, cache katmanı olmadan saniyede ~**20** istek ve ~**2,2 s** ortalama
gecikme ile kalıyor.

Bu farkın ana mesajı milisaniye kıskacı değil, **kararın görünürlüğü**:

- ssr-kit’te “bu sayfa cache’lenir mi?” sorusunun cevabı route dosyasında açık.
- Next.js POC’de aynı soru varsayılan olarak “hayır” — cache’i bilinçli eklemedikçe her istek full
  dynamic SSR kalır.

Framework’ten uzaklaşma kararımızı tek başına bu tablo gerekçelendirmez; fakat birinci yazıdaki
“örtük dynamic rendering” eleştirisinin operasyonel karşılığını sayısal olarak gösterir: **aynı
sayfa, aynı gateway, farklı cache kontratı — farklı origin kapasitesi.**

---

## Kaynaklar

- [01 — Dynamic Rendering Bizi Neden Next.js’ten Uzaklaştırdı?](./01-dynamic-rendering-bizi-neden-nextjsten-uzaklastirdi.md)
- [03 — Cache bir optimizasyon değil, route kontratıdır](./03-cache-bir-optimizasyon-degil-route-kontratidir.md)
- [nextjs-overhead-poc README](../../nextjs-overhead-poc/README.md)
- [autocannon](https://github.com/mcollina/autocannon)
- [Next.js caching](https://nextjs.org/docs/app/guides/caching)
