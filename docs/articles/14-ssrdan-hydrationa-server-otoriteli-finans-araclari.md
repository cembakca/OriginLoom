# SSR’dan Hydration’a: Server-Otoriteli Finans Araçları

Bir kredi hesaplama ekranı ilk bakışta basit görünür: üç input, bir formül ve birkaç sonuç kutusu.
Finans ürününde asıl mimari soru formülün nasıl yazıldığı değil, **sonucun otoritesinin nerede
yaşadığıdır**. Aynı taksit hesabını SSR loader'ında, React island'ında ve mobil uygulamada ayrı ayrı
uygularsak yuvarlama farkı bile kullanıcıya üç farklı toplam ödeme gösterebilir.

Bu yazıda `/araclar/kredi-hesaplama`, `/karsilastir/kredi-kartlari` ve `/bankalar/:slug` route'ları
üzerinden progressive enhancement, hydration eşitliği, gateway otoritesi ve cache cardinality
sınırlarını inceliyoruz.

## Next.js’ten çıkınca kaybolan şey form değil, varsayılan sahiplikti

Next.js App Router aynı route ağacında Server Component, Client Component ve Route Handler sınırları
sunuyor. Meta-framework'ten çıktığımızda `"use client"` yazıp veri akışını framework'e bırakmıyoruz;
şu kararları kendimiz ilan ediyoruz:

- İlk HTML'i hangi loader üretir?
- Client hangi DOM'u hydrate eder?
- Etkileşimli hesaplama hangi same-origin endpoint'e gider?
- Query varyantı cache ve canonical kimliğini değiştirir mi?
- JavaScript yüklenemezse kullanıcı hangi davranışı kaybeder?

React'in `hydrateRoot` kontratı, client ağacının server HTML'iyle aynı başlangıç çıktısını üretmesini
bekler. Hydration bir “HTML'i yeniden çiz” mekanizması değil, var olan DOM'a davranış ekleme
mekanizmasıdır. Bu nedenle gateway'den gelen ilk hesaplama hem island prop'u hem server-render edilen
child için aynı nesnedir.

```tsx
<Island name="loan-calculator" mode="hydrate" props={data} eager>
  <LoanCalculatorIsland {...data} />
</Island>
```

Client registry aynı modülü yükler ve aynı props ile `hydrateRoot` çağırır. Recoverable, caught ve
uncaught React hataları ortak client telemetry hattına gider.

## Progressive enhancement: form önce HTTP kontratıdır

Hesaplayıcı formu şu temel davranışla başlar:

```html
<form method="get" action="/araclar/kredi-hesaplama">
  <input name="amount" type="number" />
  <select name="term">
    ...
  </select>
  <input name="rate" type="number" />
  <button type="submit">Ödeme planını hesapla</button>
</form>
```

JavaScript yoksa browser yeni URL'e gider, route loader gateway'i çağırır ve yeni document döner.
Island hydrate olduysa aynı submit engellenir, bounded query same-origin BFF'e gönderilir ve yalnız
sonuç bölgesi React state'iyle yenilenir. İyileştirme JS ile gelir; temel işlev JS'ye bağlı değildir.

Input değerleri crawler için link inventory'si değildir. Base araç route'u indexlenebilir; kullanıcıya
özel query sonuçları gateway SEO payload'ında `noindex` olur ve canonical base route'a döner.

## Formül neden client’ta değil?

Mock gateway sürümlü bir sonuç döndürür:

```ts
type LoanCalculatorData = {
  calculationVersion: string;
  input: {
    productType: "housing-loan";
    amount: number;
    term: number;
    monthlyInterestRate: number;
  };
  constraints: {
    amount: Range;
    term: { options: number[] };
    monthlyInterestRate: Range;
  };
  result: {
    monthlyPayment: number;
    totalPayment: number;
    totalInterest: number;
    paymentPlan: Row[];
  };
  disclosure: string;
};
```

`calculationVersion` debug etiketi değil, domain geçiş noktasıdır. Gerçek gateway devreye girdiğinde
vergi, tahsis ücreti, sigorta, gün sayısı ve yuvarlama kuralı ayrı sürümlere evrilebilir. UI sonuç
alanlarını gösterir; finans matematiğinin sahibi olmaz.

```text
İlk request
Browser ──GET document──> Hono route ──GET calculation──> Gateway
Browser <──────SSR form + sonuç + payment plan────────── Hono

Hydration sonrası
Island ──GET /api/finance/loan-calculation──> Hono BFF ──GET──> Gateway
Island <──────────── validated no-store JSON ─────────────────
```

BFF `Cache-Control: private, no-store` döndürür. Input gateway'e gitmeden önce UI sunucusunda da
doğrulanır: tutar `100.000..10.000.000`, vade kapalı seçenek kümesi, faiz en fazla iki ondalık ve
`0,01..20` aralığıdır. Gateway cevabı ayrıca finite number, satır sayısı, string ve payload byte
limitlerinden geçer.

## Cache: içeriği değiştiren her query cache key’i değildir

Kredi tutarı HTML'i değiştirir. Buna rağmen onu Redis key'ine eklemek doğru değildir. “İçeriği
değiştiriyor” cache için gerekli ama yeterli koşul değildir; domain cardinality'si de bounded
olmalıdır.

```text
milyonlarca olası tutar
× yüzlerce faiz değeri
× 7 vade
× locale/device/layout varyantları
= kontrolsüz keyspace
```

Bu nedenle hesaplama route'u `neverCache()` kullanır. Kart karşılaştırması da seçime özel ve
`noindex` olduğu için cache dışıdır. Buna karşılık `/bankalar/:slug` küçük, gateway tarafından
sahiplenilen bir banka kümesine sahiptir; 15 dakikalık shared cache anlamlıdır.

Bu üç route aynı cache politikasını kullanmamalıdır. Route kontratı tam da bu farkı görünür yapmak
için vardır.

## Karşılaştırma URL’si: bounded, canonical ve JavaScript’siz

Kart karşılaştırması iki veya üç benzersiz lowercase slug kabul eder:

```text
/karsilastir/kredi-kartlari?products=maximum,bonus,axess
```

Üç standart `<select name="products">` JavaScript olmadan repeated query üretir. Server bunu tek
comma-separated biçime `308` ile normalize eder. Duplicate, dördüncü ürün, uzun veya unsafe slug
404'tür. Bilinmeyen ama sentaktik olarak geçerli slug gateway'den 404 olur.

Seçim sayfaları base canonical ve `noindex,follow` kullanır. Böylece kullanıcı paylaşılabilir bir
karşılaştırma URL'i alır; arama motoru her kombinasyonu ayrı landing page olarak indekslemez. Semantik
kart detay linkleri follow edilmeye devam eder.

## Banka profili neden ayrı route?

`/bankalar/:slug`, ürün liste sayfasının filtrelenmiş kopyası değildir. Bankayı bir entity olarak
tanımlar, konut kredisi ve kart koleksiyonlarını aynı gateway payload'ında toplar ve
`BankOrCreditUnion` JSON-LD üretir. Route'un kendi canonical'ı ve breadcrumb'ı vardır.

Gateway profili bounded müşteri kanalları, ürün koleksiyonları ve HTTPS website kontratı taşır.
Referral CTA yine browser'ın verdiği dış URL'e güvenmez; server-side gateway ticket'ı üretildikten
sonra güvenli 303 döner.

## Hata ve loading davranışı

Hydrated hesaplama yeni request başlatırken eski doğrulanmış sonucu tutar. Bu kasıtlıdır: finans
ekranında boş skeleton'a dönmek, kullanıcının karşılaştırdığı sayıları kaybetmesine neden olur.
Buton disabled olur, sonuç bölgesi `aria-busy` taşır ve hata `aria-live` alanında görünür.

Gateway `5xx` verdiğinde UI client tarafında formül tahmin etmez. Kullanıcı son sonucu görmeye devam
eder ve tekrar deneyebilir. Invalid input ise gateway yükü oluşturmadan BFF'te `400`, document
route'unda `404` olur.

## Production’a geçerken mock’tan ne kalır?

Mock içerik ve oranlar atılır; şu kontratlar kalır:

- versioned calculation response;
- aynı formula endpoint'ini kullanan SSR ve BFF;
- bounded input ve payload validation;
- no-JS form davranışı;
- cache cardinality kararı;
- canonical/noindex karşılaştırma politikası;
- server-side referral destination;
- golden fixture ve fuzz test yüzeyi.

Gerçek gateway entegrasyonunda domain ekibi her hesaplama sürümü için sabit örnekler sağlamalıdır.
UI testleri bu fixture'ları yalnız görüntüleme açısından, gateway contract testleri ise yuvarlama ve
toplam eşitliği açısından doğrulamalıdır.

## Sonuç

Framework'süz SSR'da iyi bir finans aracı “React ile hesap yapan form” değildir. İyi sistem;
otoriteyi gateway'de tutan, SSR ile hydration'ı aynı veride buluşturan, JavaScript'siz çalışan ve
yüksek cardinality'yi cache'e taşımayan sistemdir.

Bu sayfalar island architecture'ın yalnız kişiselleştirme veya canlı piyasa için olmadığını da
gösteriyor. Island, server HTML'i ile etkileşimli yaşam döngüsü arasındaki açık kontrattır.

## Kaynaklar

- [React `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot)
- [React DOM server API'leri](https://react.dev/reference/react-dom/server)
- [MDN — Progressive enhancement](https://developer.mozilla.org/en-US/docs/Glossary/Progressive_Enhancement)
- [MDN — Form submission](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Sending_and_retrieving_form_data)
- [Google canonical URL rehberi](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google robots meta rehberi](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
- [Schema.org `BankOrCreditUnion`](https://schema.org/BankOrCreditUnion)
