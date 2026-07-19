# Büyük Bundle’dan Kontrollü Runtime’a: Islands ve Progressive Hydration

> Islands mimarisi “React hiç indirilmez” garantisi değildir. Doğru vaat, her route'un yalnız ihtiyaç
> duyduğu client davranışını keşfedilebilir, ölçülebilir ve bağımsız chunk'lar halinde yüklemesidir.

Next.js’ten Hono + React SSR’a geçtiğimizde server cache kararlarını görünür hale getirdik. Fakat
framework’ün client runtime kararlarını da artık biz taşıyorduk. İlk implementasyonda `entry.client`
React DOM, TanStack Query ve etkileşimli bileşenleri statik import ediyordu. Bir sayfada yalnız küçük
bir menü olsa bile bütün client grafiği başlangıç chunk’ına giriyordu.

Sorun React’in varlığı değil, dependency graph’ın tek entry altında birleşmesiydi.

## Bir route'un JavaScript maliyeti tek dosya değildir

Bundle raporundaki “entry 5 kB” değerini sayfanın toplam JavaScript maliyeti diye okumak hatalıdır.
Browser şu katmanların bir bölümünü veya tamamını indirebilir:

```text
bootstrap entry
  └─ hydration runtime (React + React DOM)
       ├─ global eager island'lar
       ├─ route island'ları
       └─ island'a özel provider/dependency'ler
```

Toplam transfer; HTML’de hangi island’ların bulunduğuna, hangilerinin preload edildiğine, ortak
chunk’ların browser cache’inde olup olmadığına ve sıkıştırmaya bağlıdır. Bu yüzden tek chunk boyutu ile
“statik sayfa sıfır React” sonucu çıkarılamaz.

Projede her document’te `layout-client` ve `page-analytics` bulunduğu için bugünkü global shell React
runtime’ını gerçekten kullanır. Sıfır-JavaScript route hedeflenirse bu global island’ların da o route
için kaldırıldığı `minimalChrome` benzeri açık bir document kontratı gerekir.

## 1. Bootstrap ile hydration runtime’ını ayırmak

`entry.client.tsx` yalnız DOM’daki `[data-island]` elemanlarını bulur, sonradan stream edilen island’ları
izler ve gerektiğinde `hydrate.client` modülünü dynamic import eder. React ve `react-dom/client` ana
entry’nin statik import grafiğinde değildir.

```ts
const elements = document.querySelectorAll<HTMLElement>("[data-island]");

if (elements.length > 0) {
  import("./hydrate.client")
    .then(({ mount }) => bootstrapIslandElements(elements, (element) => void mount(element)))
    .catch((error) => reportClientError("island-bootstrap", error));
}
```

Bu bölme iki kazanç sağlar:

- Island olmayan özel document’ler hydration runtime’ını indirmek zorunda kalmaz.
- Bootstrap, React graph’ından bağımsız küçük ve kolay denetlenebilir bir lifecycle katmanı olur.

Fakat normal application shell global island içerdiği için ikinci chunk’ın yükleneceği gerçeğini
saklamıyoruz. Optimizasyonun değeri yalnız “React’i hiç yüklememek” değil; React’i bootstrap’tan ve
route’a özel ağır bağımlılıklardan ayırmaktır.

## 2. Island registry gerçek code-splitting sınırıdır

Island dosyaları `import.meta.glob()` ile lazy importer registry’sine dönüşür. Runtime bir island adı
gördüğünde yalnız ilgili modülü ister:

```text
data-island="market-live"   → src/islands/market-live.tsx
data-island="user-chrome"   → src/islands/user-chrome.tsx
```

Bu isim aynı zamanda runtime contract’tır. Server bilinmeyen bir island üretirse production manifest
ve client registry bunu sessizce tolere etmez; test/build aşamasında görünür olması gerekir.

## 3. Provider'ı kullanan island'a taşımak

TanStack Query’yi hydration root’unun tamamına provider olarak koymak, query kullanmayan bütün
island’lara kütüphane maliyetini taşır. Provider yalnız query kullanan island’ın içinde yaşar:

```tsx
export default function BlogExplorer(props: Props) {
  return (
    <AppQueryProvider>
      <BlogExplorerInner {...props} />
    </AppQueryProvider>
  );
}
```

Bu kararın bedeli bağımsız root’ların otomatik olarak tek QueryClient paylaşmamasıdır. Aynı query
state’ini birden fazla island paylaşacaksa singleton client veya external store açıkça tasarlanmalıdır.
“Provider’ı içeri taşı” mekanik bir performans kuralı değil, state ownership kararıdır.

## 4. Eager, viewport ve preload farklı kavramlardır

- `eager`: island’ın mount zamanını öne alır.
- viewport/deferred scheduling: görünür olana kadar mount’u erteler.
- `modulepreload`: network discovery’yi öne alır, modülü çalıştırmaz.

Global eager island’lar production manifest üzerinden head’de preload edilir. Route’a özel bir island
ilk ekranda kritikse route `preloadIslands` ile bunu ayrıca ilan edebilir. Bütün dynamic entry’leri
preload etmek code-splitting avantajını ağ katmanında geri alır.

BIST sayfasındaki `market-live` bu ayrımı görünür kılar. Chunk bütün siteye global olarak eklenmez;
yalnız BIST document’inde island bulunduğunda yüklenir. SSE bağlantısı da mount’tan sonra açılır.

## 5. Bağımlılık silmek ile doğru import aynı şey değildir

İkonlarda uygulama içi SVG component üretimi kullandık. Bu, birkaç basit shell ikonunun geniş bir
paketin ortak runtime’ına bağlanmasını engeller. Güncel source graph’ında `lucide-react` import’u yoktur;
dolayısıyla client bundle’a girmez. Buna karşılık paket hâlâ `package.json` dependency listesinde
duruyor. “Bundle’dan çıkarmak” ile “dependency’yi repository’den kaldırmak” aynı tamamlanma kriteri
değildir; ikincisi lockfile ve supply-chain yüzeyi için ayrı bir temizlik işidir.

Genel kural:

- Package deep import’u gerçekten public API ise kullan.
- Barrel import’un tree-shaking davranışını tahmin etme; bundle analyzer ile doğrula.
- Aynı dependency’yi farklı island’larda kopyalamak yerine Vite’ın shared chunk üretimini kontrol et.
- Yalnız byte azaltmak için maintainability’yi bozan private path import’larına girme.

## 19 Temmuz 2026 build snapshot'ı nasıl okunmalı?

Vite 8.1.5 production build’i aşağıdaki seçili chunk’ları raporladı:

| Chunk             |       Raw |     Gzip | Yorum                                  |
| ----------------- | --------: | -------: | -------------------------------------- |
| `entry.client`    |   5.08 kB |  2.29 kB | Hafif bootstrap                        |
| `hydrate.client`  | 181.94 kB | 57.79 kB | React hydration graph’ının ana parçası |
| `market-live`     |   5.92 kB |  2.32 kB | Yalnız canlı piyasa island’ı           |
| `loan-calculator` |   5.90 kB |  2.06 kB | Server-otoriteli hydrate form          |
| `user-chrome`     |  49.93 kB | 16.91 kB | Auth/query ağırlıklı kişisel island    |

Bu tablo route toplamı değildir. Örneğin `market-live` çalışırken hydration runtime ve manifestteki
ortak React chunk’ları da gerekebilir. Rakamlar build çıktısının 19 Temmuz 2026 snapshot’ıdır; her build
hash ve boyutu değiştirebilir. CI’da budget koyacaksak raw tekil chunk yerine route bazlı transfer ve
parse/execute maliyetini ölçmeliyiz.

Önceki 4.41 kB / 2.07 kB bootstrap ölçümü eski bir build’e aitti. Onu bugünkü sayfanın toplam maliyeti
olarak sunmak yanıltıcı olurdu; bu nedenle tarihsel iddia yerine yeniden üretilebilir build çıktısını
ve kapsamını birlikte veriyoruz.

## Ölçüm checklist'i

1. Production build kullan; Vite dev/HMR grafiğini kıyaslama.
2. Route’u boş browser cache ve sıcak cache ile ayrı ölç.
3. Transfer size, resource size, parse ve execute süresini ayır.
4. Hangi island’ın hangi anda import edildiğini Network initiator’dan doğrula.
5. Viewport dışı island’ın scroll öncesi indirilmediğini kontrol et.
6. LCP görseli/font ile modulepreload bandwidth yarışını izle.
7. Düşük seviye cihazda INP ve long task ölç.
8. Client error telemetry’de chunk load, mount timeout ve recoverable hydration hatalarını ayır.

## Sonuç

Islands mimarisinin dürüst performans vaadi şudur:

> Client davranışını route ve component sınırlarına böler; ama gerçekten kullanılan React runtime’ını
> sihirli biçimde yok etmez.

Bootstrap ayrımı, lazy registry, provider ownership ve manifest preload birlikte kullanıldığında ağır
özellikler ihtiyaç duyulan route’a taşınır. Başarıyı tek bir küçük entry dosyasıyla değil, gerçek route
waterfall’ı ve kullanıcı cihazındaki çalışma süresiyle ölçmek gerekir.

---

## Kaynaklar

- [React `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot)
- [Vite Features — Dynamic Import ve Glob Import](https://vite.dev/guide/features.html#glob-import)
- [Vite Backend Integration ve Manifest](https://vite.dev/guide/backend-integration)
- [MDN `modulepreload`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/modulepreload)
- [Island Architecture ile Cache-Safe Kişiselleştirme](./04-island-architecture-ile-cache-safe-kisisellestirme-ve-auth.md)
- [Vite Manifest ile Island Preload](./07-vite-manifest-ile-island-modulepreload.md)
