# Linkler

Uygulama içi her link `@originloom/react/lib/link` içindeki `Link` bileşeninden geçer:

```tsx
import { Link } from "@originloom/react/lib/link";

<Link href="/catalog">Katalog</Link>
<Link href="https://partner.example" target="_blank">Partner</Link>
```

Ham `<a>` yazmak yasak değil ama bilinçli bir tercih olmalı: aşağıdaki kuralların hiçbiri
uygulanmaz. Bir kural on sekiz yerde elle uygulandığında on dokuzuncuda uygulanmaz.

## Ne yapıyor

| Durum                                                 | Sonuç                                       |
| ----------------------------------------------------- | ------------------------------------------- |
| `javascript:`, `vbscript:`, `data:`, `blob:`, `file:` | **`href` hiç basılmaz** — gezinme oluşmaz   |
| `target="_blank"`                                     | `rel="noopener noreferrer"` eklenir         |
| Farklı origin                                         | `rel="noopener"` eklenir                    |
| `//host/yol`                                          | Dış URL sayılır (yol kılığındaki dış adres) |
| Bulunulan sayfa                                       | `aria-current="page"`                       |
| `/api/*`, `#bölüm`, `?page=2`                         | Olduğu gibi bırakılır                       |

Yazarın verdiği `rel` korunur, üstüne eklenir (`rel="sponsored"` + `_blank` → üçü birlikte).

## Reddedilen şema neden `#` olmuyor?

`href` tamamen düşürülür. `#`'e çevrilse görünüşte çalışan ama hiçbir yere gitmeyen bir link
kalırdı; href'siz bir anchor ise odaklanılamaz ve erişilebilirlik ağacında link olarak durmaz —
yani sorun görünür olur.

Şema tespiti tarayıcı gibi okur: tarayıcı şema ayrıştırırken boşluk ve kontrol karakterlerini yok
saydığı için `java\tscript:` de reddedilir.

## `aria-current` ve query

Bulunulan sayfa karşılaştırması **query'yi de** hesaba katar: `/catalog` ile `/catalog?page=2` aynı
sayfa değildir. Aksi halde 2. sayfadayken 1. sayfaya giden link "buradasınız" diye işaretlenirdi.

Bölüm bazlı işaretleme istiyorsanız (örneğin `/blog/*` altındaki her sayfada "Blog" linki aktif
görünsün) `current` prop'unu kendiniz verin:

```tsx
<Link href="/blog" current={publicPath.startsWith("/blog")}>
  Blog
</Link>
```

## Bulunulan sayfayı nereden biliyor?

Platform her istekte `publicPath`, query ve `siteUrl`'ü bir React context'i olarak sağlar —
dokümanın etrafında sunucuda, her island'ın etrafında client'ta. Island'lar ayrı React kökleridir;
platform bu değerleri dokümana `<script type="application/json" id="originloom-request">` olarak
basar ve island runtime'ı okur. O blok **veri**, kod değil: tarayıcı çalıştırmaz, CSP nonce'u
gerektirmez.

Kendi kodunuzda da okuyabilirsiniz:

```tsx
import { useRequestContext } from "@originloom/react/lib/request-context";

const { publicPath, search, siteUrl } = useRequestContext();
```

## Client-side navigation yok

Her gezinme tam sayfa yüküdür. Bu bilinçli: cache'lenmiş HTML dokümanı mimarinin merkezinde ve geri
tuşu tarayıcının bfcache'iyle bir SPA router'ından hızlı çalışır. Bunun bir koşulu var — açık bir
bağlantı sayfayı bfcache'e uygunsuz kılar. `src/islands/live-ticks.tsx` bu yüzden `pagehide`'da
bağlantıyı kapatıp `pageshow`'da geri açar; SSE veya WebSocket açan her island aynısını yapmalıdır.
