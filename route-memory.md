# Route Migration Memory

Bu dosya, `Archive/` altındaki eski Next.js ürün uygulamaları ile
`OriginLoomSigorta/` içindeki OriginLoom implementasyonları arasındaki kalıcı
eşleştirme kaydıdır. Yeni bir sayfa taşınırken kaynak proje, public URL, eski
`page.tsx`, OriginLoom route'u ve feature bileşeni önce bu dosyadan belirlenir.

> Bu dosyadaki en önemli sahiplik kuralı: `recourse/yönlendirme` sayfasının
> kaynağı **Revolt projesidir**. Sigorta slug'larının aynı OriginLoom route'unda
> desteklenmesi kaynak sayfanın Insurance olduğu anlamına gelmez.

## Proje sahipliği

| Ürün/public URL alanı                    | Kaynak Next.js projesi                   |
| ---------------------------------------- | ---------------------------------------- |
| `sigorta`                                | `Archive/hangikredi.insurance.fe.next`   |
| `kredi-karti`                            | `Archive/hangikredi.revolt.fe.next`      |
| `tasit-kredisi`                          | `Archive/hangikredi.orion.fe.next`       |
| `yatirim-araclari`                       | `Archive/HangiKredi.Stocks-Fund.FE.Next` |
| `recourse`, `/basvuru/:page/yonlendirme` | `Archive/hangikredi.revolt.fe.next`      |

## OriginLoom sayfa modeli

Next.js'teki tek bir `src/app/**/page.tsx`, OriginLoom tarafında çoğunlukla şu
sorumluluklara ayrılır:

1. `OriginLoomSigorta/server/routes/*.tsx`: route eşleştirme, loader, cache,
   metadata, param doğrulama ve sayfa bileşeni seçimi.
2. `OriginLoomSigorta/server/services/*`: gateway erişimi, payload doğrulama,
   request memoization ve veri cache'i.
3. `OriginLoomSigorta/src/features/*-page.tsx`: SSR sayfa kompozisyonu.
4. `OriginLoomSigorta/src/components/*`: tekrar kullanılabilir, varsayılan olarak
   server-rendered UI parçaları.
5. `OriginLoomSigorta/src/islands/*`: yalnız gerçekten istemci etkileşimi gereken
   küçük sınırlar.
6. `OriginLoomSigorta/server/api/*`: island'ın ihtiyaç duyduğu same-origin BFF
   uçları; tarayıcı gateway'e doğrudan bağlanmaz.

Bir eşleştirme yalnız dosya adına göre kabul edilmez. Public URL davranışı,
gateway endpoint'i, query/param dönüşümü, SEO, analytics ve UI bölümleri de
karşılaştırılır.

## Mevcut implementasyon matrisi

### Sigorta → Insurance

| Eski public URL                                          | Archive Next.js page                                                                      | OriginLoom internal route                        | OriginLoom feature page                                                                     | Durum            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------- |
| `/sigorta`                                               | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/page.tsx`                           | `/`                                              | `OriginLoomSigorta/src/features/home/home-page.tsx`                                         | Implement edildi |
| `/sigorta/kasko`                                         | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/kasko/page.tsx`                     | `/kasko`                                         | `OriginLoomSigorta/src/features/kasko/kasko-page.tsx`                                       | Implement edildi |
| `/sigorta/zorunlu-trafik-sigortasi`                      | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/zorunlu-trafik-sigortasi/page.tsx`  | `/zorunlu-trafik-sigortasi`                      | `OriginLoomSigorta/src/features/zorunlu-trafik-sigortasi/zorunlu-trafik-sigortasi-page.tsx` | Implement edildi |
| `/sigorta/motorlu-tasitlar-vergisi`                      | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/motorlu-tasitlar-vergisi/page.tsx`  | `/motorlu-tasitlar-vergisi`                      | `OriginLoomSigorta/src/features/motorlu-tasitlar-vergisi/motorlu-tasitlar-vergisi-page.tsx` | Implement edildi |
| `/sigorta/dask`                                          | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/dask/page.tsx`                      | `/dask`                                          | `OriginLoomSigorta/src/features/dask/dask-page.tsx`                                         | Implement edildi |
| `/sigorta/arac-kasko-deger-listesi`                      | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/arac-kasko-deger-listesi/page.tsx`  | `/arac-kasko-deger-listesi`                      | `OriginLoomSigorta/src/features/arac-kasko-deger-listesi/vehicle-values-page.tsx`           | Implement edildi |
| `/sigorta/konut-sigortasi`                               | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/konut-sigortasi/page.tsx`           | `/konut-sigortasi`                               | `OriginLoomSigorta/src/features/konut-sigortasi/konut-sigortasi-page.tsx`                   | Implement edildi |
| `/sigorta/saglik-sigortasi`                              | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/saglik-sigortasi/page.tsx`          | `/saglik-sigortasi`                              | `OriginLoomSigorta/src/features/saglik-sigortasi/saglik-sigortasi-page.tsx`                 | Implement edildi |
| `/sigorta/saglik-sigortasi/tamamlayici-saglik-sigortasi` | `.../saglik-sigortasi/tamamlayici-saglik-sigortasi/page.tsx`                              | `/saglik-sigortasi/tamamlayici-saglik-sigortasi` | Aynı feature page (`TamamlayiciSaglikSigortasiPage` varyantı)                               | Implement edildi |
| `/sigorta/:insuranceType/:company`                       | `Archive/hangikredi.insurance.fe.next/src/app/sigorta/[insuranceType]/[company]/page.tsx` | `/:insuranceType/:company`                       | `OriginLoomSigorta/src/features/insurance-company/insurance-company-page.tsx`               | Implement edildi |

Notlar:

- Insurance projesindeki `src/app/page.tsx` gerçek ürün sayfası değil, lokal
  route launcher'ıdır. Sigorta ana sayfasının kaynağı `src/app/sigorta/page.tsx`
  dosyasıdır.
- `/:insuranceType/:company` route tablosundaki **en geniş** desendir: `/sigorta`
  prefix'i edge'de düştüğünde düz `/:a/:b` olur. İki şey onu güvenli tutuyor ve
  ikisi de taşıyıcı: (1) tabloda **en sonda** duruyor — eşleşme ilk eşleşene
  gider ve `validateParams` başarısızlığı 404'tür, bir sonraki route'a düşmez,
  yani `/saglik-sigortasi/tamamlayici-saglik-sigortasi` gibi spesifik iki
  segmentli route ondan önce gelmek zorunda; (2) `insuranceType` I/O'dan önce
  ürün allowlist'ine (`src/lib/insurance/insurance-company-types.ts`) karşı
  doğrulanıyor. Sıralamayı `tests/route-table-order.test.ts` tutuyor.
- OriginLoom route tablosu sigorta sayfalarını `/`, `/kasko` gibi internal
  yollarla tanımlar. Production'daki `/sigorta` prefix'inin ingress/router
  katmanında ele alındığı varsayımını yeni taşımalarda doğrula; sessizce yeni
  bir prefix kuralı uydurma.

### Kredi kartı → Revolt

| Eski public URL                   | Archive Next.js page                                                                          | OriginLoom route                            | OriginLoom feature page                                                               | Durum                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------- |
| `/kredi-karti/sorgulama`          | `Archive/hangikredi.revolt.fe.next/src/app/kredi-karti/sorgulama/page.tsx`                    | `/kredi-karti/sorgulama`                    | `OriginLoomSigorta/src/features/kredi-karti-sorgulama/kredi-karti-sorgulama-page.tsx` | Implement edildi                             |
| `/kredi-karti/sorgulama/:slug`    | `Archive/hangikredi.revolt.fe.next/src/app/kredi-karti/sorgulama/[slug]/page.tsx`             | `/kredi-karti/sorgulama/:categorySeoUrl`    | Aynı feature page                                                                     | Implement edildi; kategoriler birleştirildi  |
| `/kredi-karti/finansman-kartlari` | `Archive/hangikredi.revolt.fe.next/src/app/kredi-karti/sorgulama/finansman-kartlari/page.tsx` | `/kredi-karti/sorgulama/finansman-kartlari` | Aynı feature page                                                                     | Implement edildi; public alias `rules.ts`'te |

Revolt'ta `finansman-kartlari` ayrı bir statik page'dir ve gateway'e
`categorySeoUrl=finansman-kartlari` gönderir. OriginLoom bunu generic kategori
route'unda birleştirir. Eski Revolt rewrite'ı
`/kredi-karti/finansman-kartlari` adresini
`/kredi-karti/sorgulama/finansman-kartlari` adresine taşıyordu; bu alias artık
`OriginLoomSigorta/src/routing/rules.ts` içinde ve `tests/routing-rules.test.ts`
onu tutuyor.

### Taşıt kredisi → Orion

| Public URL                                                     | Archive Next.js page                                                                   | Eski internal route                           | OriginLoom internal route          | OriginLoom feature page                                                         | Durum            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| `/kredi/tasit-kredisi/sorgulama`                               | `Archive/hangikredi.orion.fe.next/src/app/(baselayout)/loan/vehicleloan/list/page.tsx` | `/loan/vehicleloan/list`                      | `/vehicle-loans/list`              | `OriginLoomSigorta/src/features/tasit-kredisi/tasit-kredisi-sorgulama-page.tsx` | Implement edildi |
| `/kredi/tasit-kredisi/sorgulama/:maturity-ay-:amount-tl-kredi` | Aynı Next.js page                                                                      | Rewrite ile `maturity` ve `amount` query'leri | `/vehicle-loans/list/:popularSlug` | Aynı feature page                                                               | Implement edildi |

Orion popüler URL'yi Next.js rewrite aşamasında query'ye çevirir. OriginLoom
public URL'yi korur, slug'ı route parametresi olarak alır ve loader tarafında
çözümler. Parity kontrolü yalnız render edilen listeyle sınırlı değildir;
canonical, redirect ve geçersiz slug davranışları da karşılaştırılır.

### Yatırım araçları → Stocks/Funds

| Public URL                          | Archive Next.js page                                                     | Internal route   | OriginLoom feature page                                              | Durum            |
| ----------------------------------- | ------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------- | ---------------- |
| `/yatirim-araclari/endeksler`       | `Archive/HangiKredi.Stocks-Fund.FE.Next/src/app/indices/page.tsx`        | `/indices`       | `OriginLoomSigorta/src/features/endeksler/endeksler-home-page.tsx`   | Implement edildi |
| `/yatirim-araclari/endeksler/:slug` | `Archive/HangiKredi.Stocks-Fund.FE.Next/src/app/indices/[slug]/page.tsx` | `/indices/:slug` | `OriginLoomSigorta/src/features/endeksler/endeksler-detail-page.tsx` | Implement edildi |

Public → internal rewrite'lar
`OriginLoomSigorta/src/routing/rules.ts` içinde açıkça tanımlıdır. Yeni yatırım
sayfalarında Stocks/Funds projesinin `next.config.mjs` rewrite'ı kaynak gerçek
olarak incelenmelidir; yalnız `src/app` klasör adına bakılmaz.

### Recourse/yönlendirme → Revolt

| Public URL                   | Kaynak Archive page                                                           | OriginLoom internal route  | OriginLoom feature page                                     | Durum                            |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `/basvuru/:page/yonlendirme` | `Archive/hangikredi.revolt.fe.next/src/app/recourse/[page]/redirect/page.tsx` | `/recourse/:page/redirect` | `OriginLoomSigorta/src/features/recourse/recourse-page.tsx` | Implement edildi ve genişletildi |

Kaynak sahipliği kesin olarak **Revolt**'tur. OriginLoom implementasyonu aynı
sayfa akışını ortaklaştırıp şu slug'ları destekler:

- `kredi-karti` → `creditcard` gateway namespace
- `kasko` → `insurance` gateway namespace
- `zorunlu-trafik-sigortasi` → `insurance` gateway namespace
- `motorlu-tasitlar-vergisi` → `insurance` gateway namespace

Insurance Archive içinde eşdeğer bir recourse `page.tsx` bulunmaması beklenen
durumdur; sigorta slug'ları Revolt kaynaklı sayfanın OriginLoom'da genişletilmiş
kullanımıdır.

## Taşınmamış sayfalar (boşluk haritası)

Yukarıdaki matris **yapılanları** listeler. Bu bölüm yapılmayanları listeler, çünkü
her turda Archive'ı yeniden taramak aynı işi yeniden yapmaktır.

Sayı: Archive'da ~100 `page.tsx`, matriste 15. Aşağıdakiler ürün sayfalarıdır;
`/docs`, `/revolt-docs`, `/yeni/refresh-token-test-page` gibi geliştirici
sayfaları kapsam dışıdır.

### Sigorta — tamamlandı

Insurance projesindeki dokuz ürün sayfasının tamamı ve şirket detay route'u
taşındı. `/pages/calculations/insurance/*` ailesinin tamamı aynı envelope'u
döndürüyor; altısı `server/services/insurance-static-page/` fabrikasından
geliyor. Fabrikaya girmeyen iki servis ve nedenleri:

- `mtv-homepage` — form verisi, lookup'ları ve modülleriyle gerçekten farklı bir
  yükleme.
- `insurance-company-page-data` — gateway bu sayfaları id çiftiyle değil _public
  friendly URL_'iyle adresliyor
  (`/pages/calculations/insurance/{encodeURIComponent("sigorta/kasko/axa")}`),
  yani endpoint sabit değil route parametresi. Fabrika sabit endpoint alıyor.

**Bilinçli taşınmayan bölüm:** her iki sağlık sayfasındaki `nativeCards`
(%0 faizli fırsatlar). Kaynaktaki `ZeroInterestCard` ailesi kendi başına bir
kart ailesi — nakit/kart varyantları, kampanya listesi, sponsor rozeti,
koşul tooltip'i — ve OriginLoom'da hiç karşılığı yok. Sayfanın bir bölümü değil,
kendi başına bir iş; yarım hâli taşımaktansa burada yazılı duruyor.

### Kredi kartı → Revolt — 29 sayfadan 3'ü

Öncelikli eksikler: `/kredi-karti` (ana sayfa), `/kredi-karti/[bank]`,
`/kredi-karti/[bank]/[slug]` (kart detay), `/kredi-karti/kampanyalar`,
`/kart-sihirbazi` akışı, hesaplama sayfaları (`asgari-odeme-tutari-hesaplama`,
`gecikme-faizi-hesaplama`).

### Taşıt kredisi → Orion — 24 sayfadan 2'si

Öncelikli eksikler: `/loan/vehicleloan` (ana sayfa), `/vehicleloan/[bank]`,
`/vehicleloan/[bank]/[product]`, `motorcycle`, `second-hand`, `togg`
varyantları. Konut kredisi (`housingloan`) ve ihtiyaç kredisi (`consumer`)
alanlarının tamamı taşınmadı.

### Yatırım araçları → Stocks/Funds — 34 sayfadan 2'si

`indices` dışındaki her şey: `stock`, `funds`, `crypto`, `commodity`, `ipo`,
`usa-stocks`, `analyst-recommendations-list`, `stock-broker`, `tefas-funds`,
`economic-calendar`, `fund-yield-calculation`.

Liste sayfası kaynağın dört bloğundan üçünü render etmiyordu; artık parite
şeridi (`parityBandItems`), arama alanı (`/pages/investment/search`) ve haber
kartları yerinde. Haber bloğu iki ayrı bileşen: liste sayfası widget 27'yi üç
görselli kart, detay sayfası kendi `lastNews` alanını metin listesi olarak
gösterir — kaynakta da iki ayrı blok.

Taşınmayan: `ListLeadRecourseBanner` (sticky bar + banka listesi modal'ı + kendi
recourse API'si, 512 satır). Bileşen eksiği değil, kendi başına bir özellik.

Endeksler detay sayfası artık tam: grafik ve "1.000 TL ne kadar oldu" da geldi.
İkisi de kaynağın client kütüphanelerini taşımadan yazıldı — grafik SSR SVG
(`src/lib/indices-detail/chart-geometry.ts`), tooltip CSS. Bu ailenin geri
kalanı (`stock`, `funds`, `crypto`, `commodity` detayları) aynı iki bileşeni
kullanıyor, yani o sayfalar taşınırken bunlar hazır.

### Bilinen açık parity maddeleri

- `mtv-homepage` hâlâ kendi servisini taşıyor; gerekçesi yukarıda.
- Her iki sağlık sayfasında `nativeCards` taşınmadı; gerekçesi yukarıda.

Kapatılanlar: `/kredi-karti/finansman-kartlari` alias'ı, endeksler detay grafiği
ve `HowMuchWasMoney`.

## Yeni sayfa taşıma kuralları

### 1. Önce davranış envanteri çıkar

Implementasyondan önce kaynak Next.js sayfası için en az şunları kaydet:

- public URL ve Next.js internal rewrite hedefi;
- statik/dinamik route parametreleri ve query normalizasyonu;
- çağrılan gateway endpoint'leri ve request header/cookie bağımlılıkları;
- SSR'da görünen tüm UI bölümleri ve responsive varyantları;
- loading, empty, error, not-found ve redirect davranışları;
- metadata, canonical, robots ve JSON-LD;
- analytics event'leri, impression'lar ve recourse akışı;
- kullanıcıya özel alanlar ve tarayıcı API'si kullanan etkileşimler.

### 2. SSR-first, küçük island sınırları

- Sayfanın tamamını veya büyük bir section ağacını island yapma.
- Metin, heading, breadcrumb, tablo ilk görünümü, ürün kartlarının ilk verisi ve
  SEO açısından anlamlı içerik SSR HTML'de bulunmalıdır.
- `useState`, `useEffect`, event handler veya browser API gerektirmeyen bileşen
  server-rendered kalır.
- Her bağımsız etkileşim için mümkün olan en küçük island sınırını kullan.
- Island dosyası `src/islands/<kebab-name>.tsx` altında default export olmalıdır;
  `entry.client.tsx` ve `hydrate.client.tsx` elle değiştirilmez.
- Normal, herkese aynı interaktif içerik için varsayılan `mode="hydrate"` kullan.
- Kişiye özel veri/session bağımlılığı için `mode="defer"` kullan ve veriyi
  same-origin BFF üzerinden client'ta al; kişisel veriyi cache'lenmiş HTML veya
  island props içine koyma.
- Island props küçük, public ve JSON-serializable olmalıdır; token, PII ve session
  verisi taşınmaz.
- `eager` sıradan widget'larda kullanılmaz. Yalnız erken global state/analytics
  gibi ölçülmüş ve gerekçelendirilmiş istisnalarda kabul edilir.
- JavaScript yüklenmeden önce fallback markup kullanılabilir ve erişilebilir
  olmalıdır; hydration layout shift üretmemelidir.

### 3. Performans beklentisi

- Gateway çağrılarını route loader/service katmanında paralelleştir; waterfall
  oluşturma.
- Aynı request içindeki tekrarları memoize et. Cross-request cache ancak veri
  sahipliği, TTL/SWR, vary boyutları ve purge tag'i açıkça tanımlandıysa eklenir.
- Signed-in veya kişiye özel veriyi paylaşılan HTML/data cache'e sokma.
- Büyük Next.js client dependency'lerini taşımak yerine gereken davranışı küçük
  OriginLoom bileşeni/island'ı olarak yeniden yaz.
- Her yeni island için `performance-budgets.json` bütçesini bilinçli şekilde
  değerlendir. Ortak chunk'a kod saklayarak island bütçesini aşma.
- İlk görünümde gerekmeyen JS ve veriyi lazy/defer et; buna rağmen ana içerik ve
  navigasyon JS kapalıyken kullanılabilir kalmalıdır.
- Stabil boyutlar, responsive image kaynakları ve font stratejisiyle CLS'i
  engelle. Gereksiz client fetch, duplicate payload ve hydration'ı kabul etme.

### 4. UI parity ve kalite

- Archive sayfası görsel ve davranışsal referanstır: içerik hiyerarşisi,
  responsive kırılımlar, spacing, tipografi, renkler, state'ler ve CTA akışı
  karşılaştırılır.
- Eski JSX/CSS'i körlemesine kopyalama. Görünümü OriginLoom'un mevcut layout,
  component ve Tailwind konvansiyonlarıyla yeniden üret.
- Masaüstü ve mobil parity birlikte tamamlanır; yalnız desktop ekran görüntüsüne
  göre iş bitmiş sayılmaz.
- Semantic HTML, klavye kullanımı, focus görünürlüğü, label/error ilişkileri,
  heading sırası ve reduced-motion davranışı zorunludur.
- Loading, empty, error, disabled, selected, hover ve focus state'leri tasarımın
  parçasıdır; sonradan eklenecek detay olarak bırakılmaz.
- Kaynak sayfadaki kusurlar otomatik olarak taşınmaz. Bilinçli UI farkı varsa
  nedenini implementasyon notunda belirt.

### 5. Route ve veri parity

- Public URL korunur; internal route adı kullanıcıya sızdırılmaz.
- Rewrite, query, trailing slash, canonical, redirect ve 404 davranışları test
  edilir.
- Gateway payload'ı runtime'da doğrulanır; `any` ile kaynak response doğrudan UI'a
  verilmez.
- Client etkileşimleri gateway'i doğrudan çağırmaz; allowlist'li same-origin
  `server/api` endpoint'i kullanır.
- SEO ve analytics parity, UI parity kadar tamamlanma kriteridir.

## Definition of Done

Bir Next.js sayfası OriginLoom'a taşınmış sayılmadan önce:

- [ ] Bu dosyadaki matrise source page, public URL, internal route ve hedef
      feature page eklenmiş olmalı.
- [ ] Route, loader/service, feature, component ve gerekli island sınırları
      sorumluluklarına ayrılmış olmalı.
- [ ] SSR HTML ana içeriği JavaScript olmadan sunmalı.
- [ ] Kullanıcıya özel veri cache'lenmiş HTML'den ve island props'tan ayrılmış
      olmalı.
- [ ] Mobile ve desktop görsel parity gerçek browser'da karşılaştırılmış olmalı.
- [ ] Loading/empty/error/not-found/redirect senaryoları doğrulanmış olmalı.
- [ ] Metadata, canonical, robots, JSON-LD ve analytics davranışı kontrol edilmiş
      olmalı.
- [ ] Route ve servis için hedefli testler eklenmiş olmalı.
- [ ] İlgili island ve route JS bütçeleri aşılmamalı.
- [ ] `OriginLoomSigorta` içinde `pnpm ci` başarılı olmalı.

## Kaynak dosyalar

- Aktif route tablosu: `OriginLoomSigorta/server/routes/index.ts`
- Public/internal rewrite'lar: `OriginLoomSigorta/src/routing/rules.ts`
- Recourse slug sahipliği: `OriginLoomSigorta/src/lib/recourse/recourse-page-registry.ts`
- Island çalışma kuralları: `OriginLoomSigorta/.claude/skills/islands/SKILL.md`
- Performans bütçeleri: `OriginLoomSigorta/docs/performance.md` ve
  `OriginLoomSigorta/performance-budgets.json`
- Insurance source pages: `Archive/hangikredi.insurance.fe.next/src/app`
- Revolt source pages: `Archive/hangikredi.revolt.fe.next/src/app`
- Orion source pages: `Archive/hangikredi.orion.fe.next/src/app`
- Stocks/Funds source pages: `Archive/HangiKredi.Stocks-Fund.FE.Next/src/app`
