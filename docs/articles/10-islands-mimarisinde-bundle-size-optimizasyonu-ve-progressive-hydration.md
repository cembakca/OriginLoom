# Büyük Bundle Boyutundan Nasıl Kurtulduk? Islands Mimarisinde Progressive Hydration

> Hono ve React tabanlı explicit SSR mimarimizde, statik sayfalardaki 230 kB'lık gereksiz JavaScript yükünü progressive hydration, provider izolasyonu ve bağımlılıksız ikon sistemine geçerek %98 oranında nasıl düşürdüğümüzün teknik hikâyesi.

---

Next.js'ten kendi geliştirdiğimiz Hono ve React tabanlı explicit SSR mimarisine geçişimiz, sunucu tarafındaki cache kontrolünü, bellek yönetimini ve response akışlarını tamamen kontrol altına almamızı sağladı. Ancak bu geçiş, istemci tarafında (client-side) çözülmesi gereken yeni bir optimizasyon problemini de beraberinde getirdi: **İlk yükleme JavaScript paket boyutu (Initial Bundle Size).**

İlk başta her şey harika görünüyordu. Sayfalar sunucuda render ediliyor, Redis cache'inden mikrosaniyeler içinde HTML olarak dönüyor ve tarayıcıya sadece adacıkların (islands) kodları gönderiliyordu. Ancak tarayıcı geliştirici konsolunu açıp network sekmesini incelediğimizde acı bir gerçekle karşılaştık: 

> Üzerinde hiçbir etkileşimli eleman (button, form, mobile menu vb.) bulunmayan tamamen statik bir bilgi sayfasına girdiğimizde dahi, tarayıcı arka planda **230 kB (gzipped 72 kB)** boyutundaki bir JavaScript dosyasını (`entry.client.js`) indirmek ve parse etmek zorundaydı.

Bu durum, Next.js'ten kaçarken yakalandığımız klasik bir "global runtime" tuzağıydı. Sayfanın adacık mimarisine sahip olması tek başına yetmiyordu; tarayıcıdaki giriş noktamız her şeyi peşinen yüklüyordu.

---

## 1. Neden 230 kB İndiriyorduk?

İstemci tarafındaki giriş noktamız olan `entry.client.tsx` dosyasını incelediğimizde, mimariyi kurarken yaptığımız şu statik import kabullerini gördük:

```typescript
import { createRoot, hydrateRoot } from "react-dom/client";
import { AppQueryProvider } from "~/lib/query/provider";
import { Menu } from "lucide-react";
```

Bu importlar nedeniyle:
1. **React ve React DOM**: Sayfada etkileşimli tek bir alan olmasa bile tarayıcıya iniyor ve hydration runtime'ı çalıştırıyordu.
2. **TanStack Query**: Sunucu ile senkronizasyon için kullandığımız React Query kütüphanesi, global entry seviyesinde import edildiği için tüm sayfalara zorunlu olarak dağıtılıyordu.
3. **Lucide İkonları**: Basit bir hamburger menü ikonu için kütüphanenin gereksiz pek çok ortak kodu bundle içerisine sızıyordu.

Amacımız "Pure HTML" hızı ve sıfır JavaScript yükü iken, kullanıcıya her sayfa açılışında React ve React Query'nin tüm runtime motorunu yükletiyorduk. Bu problemi çözmek için mimariyi üç adımda yeniden tasarladık.

---

## 2. Çözüm 1: Progressive Hydration (Giriş Noktasını Bölmek)

İlk olarak, tarayıcıda koşan bootstrap kodu ile ağır hydration runtime'ını birbirinden ayırmaya karar verdik. Tarayıcının ilk indirdiği `entry.client.tsx` dosyası, sayfada etkileşimli bir adacık (`[data-island]`) olup olmadığını kontrol eden, hiçbir harici kütüphane bağımlılığı olmayan minik bir script olmalıydı.

Bunun için giriş noktasını ikiye böldük:
- **`entry.client.tsx` (Bootstrap)**: Sayfayı tarayan hafif gözetçi script.
- **`hydrate.client.tsx` (Hydration Runtime)**: React ve React DOM bağımlılıklarını içeren ağır yük.

Yeni bootstrap akışımız şu şekilde tasarlandı:

```typescript
// src/entry.client.tsx
import "./styles/globals.css";
import { reportClientError } from "~/lib/client/error-telemetry";
import { bootstrapIslandElements } from "~/lib/client/island-runtime";
import { installReloadButtons } from "~/lib/client/reload-button";

installReloadButtons();

// Sayfadaki adacıkları tara
const elements = document.querySelectorAll<HTMLElement>("[data-island]");

if (elements.length > 0) {
  // Sadece adacık varsa ağır React hydration kodunu dinamik olarak indir!
  import("./hydrate.client")
    .then(({ mount }) => {
      bootstrapIslandElements(elements, (element) => void mount(element));
    })
    .catch((error) => {
      reportClientError("island-bootstrap", error);
    });
}
```

Bu basit değişiklik sayesinde, statik bir sayfaya giren kullanıcılar için React ve React DOM kütüphaneleri tarayıcı tarafından **hiç indirilmez**.

---

## 3. Çözüm 2: React Query Sağlayıcısının İzolasyonu

Uygulamadaki adacıkları incelediğimizde; `mobile-menu`, `user-chrome`, `filter-panel` gibi adacıkların hiçbirinin api fetch veya global state yönetimi için React Query kullanmadığını gördük. React Query'ye sadece paginated blog listesini yöneten `blog-explorer.tsx` bileşeni ihtiyaç duyuyordu.

Buna rağmen, eski yapıda `entry.client.tsx` içindeki mount fonksiyonu her bileşeni `AppQueryProvider` ile sarıyordu. Bu da React Query'nin global pakete dahil olmasına neden oluyordu.

`AppQueryProvider` sarmalamasını global hydration kodundan çıkardık ve sadece React Query kullanan adacığın kendi içerisine taşıdık:

```typescript
// src/islands/blog-explorer.tsx
import { AppQueryProvider } from "~/lib/query/provider";

function BlogExplorerInner({ page, initialData }: Props) {
  // useBlogs hook'u burada güvenle çalışır...
}

export default function BlogExplorer(props: Props) {
  return (
    <AppQueryProvider>
      <BlogExplorerInner {...props} />
    </AppQueryProvider>
  );
}
```

### Sonuç:
Vite/Rollup kod bölme (code-splitting) algoritması, `@tanstack/react-query` kütüphanesini ana paketten söktü ve sadece `blog-explorer` adacığı yüklendiğinde asenkron olarak indirilecek olan `blog-explorer-XXXX.js` chunk'ının içerisine yerleştirdi.

---

## 4. Çözüm 3: Lucide İkon Bağımlılığından Kurtulma

Son olarak, bundle boyutunu miligram seviyesinde optimize etmek için `lucide-react` bağımlılığını inceledik. Projemizde zaten SVG dosyalarımızı optimize edilmiş, sıfır bağımlılıklı React komponentlerine dönüştüren SVGR tabanlı bir ikon oluşturucu (`generate-icons.mjs`) bulunuyordu.

Kullandığımız tüm Lucide ikonlarını (Menu, ChevronDown, X, User) projenin kendi SVG klasörüne (`src/assets/svg/`) taşıdık ve ikon scriptini koşturduk:

```bash
npm run icons
```

Bu sayede tüm harici ikon paketlerini devre dışı bırakarak projenin ürettiği native SVG React bileşenlerine geçtik.

---

## Sonuç: Somut Rakamlar

Yaptığımız bu üç optimizasyonun ardından elde ettiğimiz sonuçlar kurumsal hedeflerimiz için devasa bir sıçrama oldu:

| Metrik / Çıktı | Eski Yapı (Next.js Esintili) | Yeni Yapı (Progressive Islands) | İyileşme Oranı |
| :--- | :--- | :--- | :--- |
| **Statik Sayfa JS Boyutu** | 230.78 kB | **4.41 kB** | **%98.1 Azalma** |
| **Gzipped Statik JS** | 72.36 kB | **2.07 kB** | **%97.1 Azalma** |
| **React Query Yükü** | Global (Tüm sayfalar) | Yalnızca `/blogs` (On-demand) | **%100 İzolasyon** |
| **İkon Bağımlılığı** | `lucide-react` (Global) | Bağımsız SVG Bileşenleri | **Sıfır Bağımlılık** |

Bu mimari sayesinde, sitenin reklam veya SEO odaklı statik sayfaları artık **sıfır React yüküyle** ultra hızlı açılırken; kullanıcı etkileşimli finansal hesaplama sayfaları ise ihtiyaç anında dinamik olarak hydration runtime'ını indirip çalıştırabilmektedir.

---

## Kaynaklar

- [React 19 Dynamic Import ve Hydration Kılavuzu](https://react.dev/reference/react-dom/client/hydrateRoot)
- [Vite Dynamic Imports ve Code Splitting](https://vite.dev/guide/features.html#dynamic-import)
- [Islands Architecture (Jason Miller)](https://jasonformat.com/islands-architecture/)
