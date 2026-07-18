# 11. React 19 Progressive HTML Streaming (Akışlı SSR) Mimarisi

Geleneksel sunucu taraflı render (SSR) sistemlerinde, sayfada bulunan tüm veri çağrıları (API fetch işlemleri) tamamlanana kadar sunucu tarayıcıya HTML göndermez. Bu durum, özellikle yavaş yanıt veren harici API bağımlılıklarında sayfa açılışını (TTFB) ciddi şekilde geciktirir.

Bu döküman, `ssr-kit` platformunda React 19'un `renderToPipeableStream` motoru ile gerçekleştirdiğimiz **Progressive HTML Streaming (Akışlı SSR)** mimarisini, karşılaşılan problemleri ve bu problemlere yönelik ürettiğimiz çözümleri detaylandırır.

---

## Karşılaşılan 5 Temel Engel ve Çözümlerimiz

Akışlı SSR mimarisine geçiş, geleneksel önbellekleme ve hata yönetimi kuralları ile çelişen bazı engeller barındırır. Bu engeller platform genelinde şu şekilde çözülmüştür:

### 1. Header'lar Gönderildikten Sonra Oluşan Render Hataları

- **Problem**: Akış başladıktan sonra tarayıcıya çoktan `200 OK` HTTP durum kodu ve başlıkları gönderilmiş olur. Akış sırasında (örneğin Suspense içindeki bir bileşenin render'ında) bir hata çıkarsa HTTP durum kodunu `500` olarak değiştirmek imkansızlaşır.
- **Çözüm**: React 19'un `onShellError` ve `onAllReady` / `onError` callback yapıları entegre edilmiştir. Hata, sayfanın ana şablonu (shell) tarayıcıya iletilmeden önce oluşursa, `onShellError` tetiklenir ve yanıt temiz bir `500 Internal Server Error` durum koduna yönlendirilir. Şablon gönderildikten sonra oluşan hatalar ise React'in yerleşik **Client-Side Recovery** mekanizmasına bırakılır; tarayıcı ilgili bileşeni istemci tarafında (CSR) tekrar render etmeyi dener.

### 2. Kısmi HTML Çıktısının Önbelleğe (Redis) Yazılması

- **Problem**: Akış parça parça gerçekleştiğinden, veritabanına yazılacak olan cache `MISS` çıktıları doğrudan istemci akışıyla eş zamanlı olarak Redis'e yazılamaz. Aksi takdirde yarım kalmış veya skeleton'lı HTML önbelleğe kaydedilir.
- **Çözüm (Dual-Writer / Buffering Pattern)**:
  - Canlı kullanıcı isteklerinde (`phase === "request"`), akış doğrudan tarayıcıya gönderilir.
  - Önbelleğin doldurulması gereken durumlarda (SWR revalidation veya cold cache MISS durumlarında), `runRender` fonksiyonu arka planda `renderDocumentToStream` çağrısını başlatır ve tüm akış bitene kadar (`streamResult.allReady`) bekler. Akış tamamlandığında, `streamToString` yardımcı fonksiyonu ile tüm stream bir HTML string'ine dönüştürülüp Redis'e **tek parça atomik bir veri** olarak yazılır.

### 3. Client Disconnect (İstemci Bağlantı Kesintisi) Yönetimi

- **Problem**: Kullanıcı sayfa yüklenirken sekmeyi kapattığında, sunucunun arka planda render etmeye ve harici API'leri sorgulamaya devam etmesi kaynak israfına yol açar.
- **Çözüm**: Hono request context'inden alınan `c.req.raw.signal` (AbortSignal) dinlenir. İstemci bağlantıyı kestiğinde React stream nesnesi üzerindeki `.abort()` tetiklenerek sunucu tarafındaki render anında kesilir ve harici API'lere giden fetch istekleri iptal edilir.

### 4. CDN ve Sıkıştırma (Compression) Katmanlarının Bypass Edilmesi

- **Problem**: Nginx, Cloudflare gibi proxy'ler veya Hono'nun `compress` middleware'i, Brotli/Gzip sıkıştırması yapmak için yanıtı tamponlar (buffer). Bu durum HTML akışının tarayıcıya progressive olarak ulaşmasını engeller.
- **Çözüm**: Streaming yanıtlarında HTTP `transfer-encoding: chunked` ve `cache-control: no-transform` başlıkları eklenmiştir. Bu başlıklar aradaki tüm sıkıştırma ve proxy katmanlarına veriyi arabelleğe almadan doğrudan tarayıcıya iletmesi talimatını verir.

### 5. Googlebot ve SEO Crawler Uyumluluğu

- **Problem**: Arama motoru botları progressive akışları tam olarak beklemeyebilir veya JavaScript hydration'ı gerçekleştirmeden ham HTML'i indexlemek isteyebilir.
- **Çözüm (Conditional Buffering)**: Gelen isteklerin User-Agent bilgisi taranarak bot tespiti yapılır. İstek atan bir bot ise streaming bypass edilir, sunucuda akış sonuna kadar beklenip tam sayfa HTML tek seferde (buffered) servis edilir. Gerçek kullanıcılara ise anlık progressive akış gönderilir.

---

## İstemci Tarafı Hydration ve MutationObserver

Islands (Adacıklar) mimarisinde, sayfa ilk yüklendiğinde DOM'da bulunan adacıklar hydrate edilir. Ancak streaming modunda, sayfa ilk yüklendiğinde DOM'da sadece **loading skeleton** bulunur; gerçek adacık HTML'i sunucudaki veri çözüldükten sonra akışla gelir.

Bu durum, tarayıcıda çalışan bootstrap scriptinin adacığı kaçırmasına (unhydrated kalmasına) yol açar.

### Çözüm (Dynamic Hydration Watcher)

`src/entry.client.tsx` içerisine bir **`MutationObserver`** eklenmiştir. Bu observer:

1. Sunucudan akan yeni HTML parçalarını izler,
2. DOM'a yeni bir `[data-island]` eklendiğini fark ettiği an dinamik olarak hydration runtime'ını yükler ve adacığı hydrate eder,
3. Sayfa yüklemesi tamamen bittiğinde (`DOMContentLoaded` anında) `observer.disconnect()` çağrısı ile kendini yok ederek ** runtime CPU yükünü sıfırlar**.

---

## Nasıl Kullanılır? (How to Use)

Geliştirici olarak, bir sayfa üzerinde progressive streaming uygulamak için sadece iki adım atmanız yeterlidir:

### 1. Rota Ayarı (`streaming: true` & `neverCache`)

Rota tanımında `streaming: true` parametresi geçilir. Eğer sayfada dinamik veri akışını ve skeleton'ı her yüklemede görmek istiyorsanız cache politikası `neverCache()` olarak ayarlanır:

```tsx
import { defineRoute } from "~/lib/types";
import { neverCache } from "~/lib/cache-policy";

export default defineRoute<StreamingData>({
  path: "/blogs/paginated/streaming",
  streaming: true,
  cache: () => neverCache(), // Canlı akış için cache bypass edilir

  loader: async (ctx) => {
    // Ağır verileri Promise olarak loader'dan döneriz (await etmeden):
    const dataPromise = getSlowBlogs(ctx.request.signal);
    return {
      data: {
        page: 1,
        deferredBlogsPromise: dataPromise, // Promise olarak component'e geçer
      },
    };
  },

  Component: ({ data }) => (
    <div>
      <h1>Haberler</h1>
      {/* 2. Suspense ve Skeleton bileşeni kurgulanır: */}
      <Suspense fallback={<BlogListSkeleton />}>
        <StreamingBlogList postsPromise={data.deferredBlogsPromise} />
      </Suspense>
    </div>
  ),
});
```

### 2. Component Seviyesinde Promise Çözme (`use` hook)

React 19'un `use` hook'u kullanılarak sunucuda bekletilen Promise çözülür:

```tsx
import { use } from "react";

function StreamingBlogList({ postsPromise }) {
  // Promise çözülene kadar bu bileşen askıya alınır (Suspend olur)
  const posts = use(postsPromise);

  return (
    <Island name="blog-list" props={{ posts }}>
      <BlogList posts={posts} />
    </Island>
  );
}
```

---

## Sıkça Sorulan Sorular (FAQ) & Sık Yapılan Endişeler

### 1. Birden Fazla Yavaş Widget Varsa Hepsi Tek Skeleton'a mı Döner?

**Hayır, her bileşen kendi hızında yüklenir ve kendi skeleton'ına sahiptir.** React'in `<Suspense>` mimarisi tamamen bağımsız çalışır.

Örneğin, sayfada biri 500ms süren "Popüler Bloglar", diğeri ise 1500ms süren "Tüm Bloglar" adında iki farklı asenkron widget varsa:

- Her iki widget'ı da kendi `<Suspense>` sınırı ile ayrı ayrı sarmalayabilirsiniz.
- Sayfa yüklendiğinde iki skeleton aynı anda gösterilir.
- 500. ms'de popüler bloglar yüklenir ve kendi skeleton'ını silerek ekranda yerini alır (bu sırada diğer skeleton yüklenmeye devam eder).
- 1500. ms'de ana blog listesi de yüklenir ve kendi skeleton'ının yerini alır.

Geliştirici olarak sayfa tasarımı ve kullanıcı deneyimine göre isterseniz widget'ları tek bir ortak `<Suspense>` içine alabilir, isterseniz ayrı ayrı yüklenmelerini sağlayabilirsiniz.

### 2. Akışlı (Streaming) SSR SEO Açısından Sorun Yaratır mı?

**Hayır, platformumuzda arama motoru botları için özel bir güvenlik bariyeri bulunmaktadır.**

- `server/handler.ts` içerisinde gelen isteklerin `User-Agent` bilgisi taranır (Googlebot, Bingbot, Yandex vb. bot tespitleri yapılır).
- İstek atan bir bot ise **akışlı SSR (streaming) otomatik olarak devre dışı bırakılır**.
- Sunucu, tüm Suspense sınırlarının ve asenkron veri yüklemelerinin çözülmesini (`onAllReady`) bekler.
- Botun karşısına **hiçbir skeleton veya streaming betiği içermeyen, tamamen birleştirilmiş ve nihai içeriği barındıran statik HTML** döndürülür.
- Gerçek kullanıcılara ise anlık progressive akış gönderilerek en hızlı TTFB deneyimi sunulur.

Bu sayede platformda streaming kullanımı SEO indekslemesini hiçbir şekilde riske atmaz.

---

## Mimari Avantajlar

- **Gelişmiş TTFB & LCP**: Kullanıcı sayfa iskeletini ve logoları ilk 20-50ms içinde görür.
- **Hata İzolasyonu**: Yavaşlayan tek bir API tüm sayfanın yüklenmesini veya çökmesini engellemez.
- **Geliştirici Dostu**: Karmaşık soket veya chunk yönetim işlemleri tamamen platform katmanı (`handler.ts` ve `document.tsx`) tarafından soyutlanmıştır.
