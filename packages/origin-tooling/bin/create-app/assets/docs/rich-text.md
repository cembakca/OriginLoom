# CMS'ten gelen HTML

Gateway'den gelen bir alan paragraf, liste veya tablo taşıyorsa, onu escape etmek ürünü bozar —
metnin biçimi içeriğin parçası. Ham basmak ise **stored XSS**: içerik bir kez kötü hâle geldiğinde
(ele geçirilmiş bir editör hesabı, yanlış yapıştırılmış bir snippet, tehlikeye girmiş bir upstream)
o HTML paylaşılan cache'e giriyor ve oradan her ziyaretçiye servis ediliyor.

CSP bunun yerini tutmaz: bazı çalıştırma yollarını kapatır, ama `<iframe>`, `data:` link, sayfayı
kaplayan bir `style` ya da sahte bir form hâlâ geçer. Trusted Types de tutmaz — platformun policy'si
girdiyi **olduğu gibi** kabul eden bir identity policy; DOM sink'lerini görünür yapar, içeriği
temizlemez.

## Sözleşme

```ts
import { sanitizeRichText } from "@originloom/core/rich-text";
import { richTextHtml, type RichText } from "@originloom/shared/lib/rich-text";
```

1. **View model tipinde `RichText` kullanın**, `string` değil:

   ```ts
   export type FaqItem = { id: string; title: string; description: RichText };
   ```

2. **Mapper'da temizleyin** — gateway payload'ı view model'e dönerken:

   ```ts
   description: sanitizeRichText(detail.description),
   ```

3. **Sink'e `richTextHtml` ile verin**:

   ```tsx
   <div dangerouslySetInnerHTML={richTextHtml(item.description)} />
   ```

## Neden bu üç adım

`RichText` markalı bir tip: **string yazarak üretilemiyor**, yalnızca `sanitizeRichText` döndürüyor.
Yani çağrıyı unutan bir mapper güvensiz HTML basmıyor — **derlenmiyor**.

`richTextHtml` de tersini kapatıyor. Marka tek başına yalnız üreten tarafı korur; sink `{ __html: x }`
ile her string'i kabul eder. Fonksiyondan geçmek tüketen tarafı da derleme hatasına çeviriyor, ki altı
ay sonraki bir refactor'ün gerçekten çarptığı yer orası.

**Mapper'da, component'te değil.** İki sebep, ikincisi daha önemli: sonuç cache'lenen şey, yani iş
istek başına değil doldurma başına yapılıyor; ve temizlenmemiş markup tutan paylaşılan bir HTML
cache, view ne yaparsa yapsın sorunu çoktan saklamış oluyor.

## Allowlist

İzin verilenler: `p br hr strong b em i u s small sub sup h2–h6 blockquote ul ol li a table thead
tbody tfoot tr th td`. Öznitelikler yalnız `a[href|title|target|rel]`, `th[colspan|rowspan|scope]`,
`td[colspan|rowspan]`.

- `style`, `class`, `id`, `data-*` ve bütün olay öznitelikleri düşüyor. `style` XSS'ten çok **düzen**
  sink'i: sayfayı kaplayabilen bir içerik, bir SSS cevabından clickjack üretir.
- Link şemaları `http https mailto tel`. `javascript:` bariz olan; asıl unutulan `data:text/html` —
  editörde sıradan bir href gibi görünen, aynı sekmede saldırgan HTML'ine giden bir navigasyon.
  Protokol-göreli (`//host`) de reddediliyor.
- `target` taşıyan link'e `rel="noopener noreferrer"` **her seferinde** yazılıyor; yazarın koyduğu
  `rel` eziliyor, birleştirilmiyor.
- İzin listesinde olmayan bir element düşüyor ama **metni kalıyor**; `script`/`style`/`iframe` gibi
  olanlarda içerik de gidiyor.

Listeyi genişletmek gerekirse **ihtiyacı olan view ile birlikte, tek element** ekleyin. Gelen her
şeye uyacak şekilde büyüyen bir allowlist, allowlist olmaktan çıkar.

## Kendi ürettiğiniz HTML

Serialize edilmiş bootstrap JSON, GTM `<noscript>`, satır içi analytics script'i — bunlar ağdan
gelmiyor, uygulamanın kendi değerlerinden kuruluyor ve temizlemek tam da basılan şeyi siler. Onlar
için `trustedRichText()` var. Ağdan gelen hiçbir şeyle kullanmayın.
