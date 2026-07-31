# Liste sayfaları: filtre, sıralama, sayfalama

`server/routes/catalog.tsx` bir liste sayfasının üretimde yapması gereken her şeyi yapar. Kendi
liste sayfanızı yazarken kopyalanacak şablon odur; buradaki her madde oradaki bir satırın nedenidir.

## Tek kaynak: `src/lib/catalog-query.ts`

Sorgu kontratı **tek yerde** durur ve iki şey onu okur:

- **loader** — URL'yi gateway isteğine çevirir
- **cache key** — iki URL'nin aynı sayfa olup olmadığına karar verir

Bu ikisi ayrılırsa `?sortBy=newest`, `?sortBy=recommended`'ın cache'lenmiş HTML'ini servis eder.
Testi var (`tests/catalog-query.test.ts` → "uses the same normalizers for the cache key as for the
request") ve registry ile normalizer nesnesinin **aynı referans** olduğunu doğrular.

```ts
export const CATALOG_QUERY = ["category", "sortBy", "page"] as const;

export const catalogNormalizers = {
  category: (raw) => (raw && CATEGORIES.has(raw) ? raw : "all"),
  sortBy: (raw) => (raw && SORTS.has(raw) ? raw : "recommended"),
  page: (raw) => (Number.isSafeInteger(Number(raw)) && Number(raw) > 1 ? String(Number(raw)) : "1"),
};
```

Allowlist'te olmayan bir param ne gateway'e ne cache key'e ulaşır. `utm_source` yüzünden aynı HTML'in
yüzlerce kopyasının cache'e yazılmasını engelleyen şey budur.

## Bilinmeyen değer 404 değildir — ama geçersiz sayfa öyledir

Aradaki fark kasıtlıdır:

| URL                      | Sonuç           | Neden                                                     |
| ------------------------ | --------------- | --------------------------------------------------------- |
| `?category=saçmalık`     | 200, varsayılan | Ziyaretçi kataloğu görmeli; bilinmeyen filtre yok sayılır |
| `?page=1`, `?page=01`    | **308**         | Kataloğun ikinci adı; tek sayfa tek URL                   |
| `?page=abc`              | **404**         | Hiç var olmamış bir adres                                 |
| `?page=99` (son sayfa 3) | **404**         | Boş dönen 200 = soft 404, loglarda hiç görünmez           |

`resolvePageParam` bu üç durumu ayırır; route sadece hangisinin ne olduğuna karar verir.

## 404'e ve redirect'e giden URL cache'lenmez

```ts
cache: pageCache(PageCacheId.catalog, (ctx) =>
  resolvePageParam(ctx.url.searchParams.get("page")).kind === "valid"
    ? pageCachePolicy(PageCacheId.catalog, ctx)
    : neverCache(),
),
```

Aksi halde tek bir bozuk link, hiçbir geçerli isteğin sormayacağı key'lerin altında hata kopyalarıyla
cache'i doldurur.

## Filtreler form değil, link

Her filtrelenmiş görünüm gerçek bir URL: paylaşılabilir, indekslenebilir, yeni sekmede açılabilir ve
paylaşımlı HTML cache'inden servis edilebilir. `fetch`-ve-değiştir yaklaşımı yazması daha kolaydır ve
dördünü birden kaybeder. JavaScript kapalıyken de çalıştığının e2e testi var.

`catalogHref(current, patch)` iki kural uygular:

- **Varsayılanlar düşer** — `/catalog?category=all&sortBy=recommended&page=1` değil, `/catalog`.
- **Filtre değişince sayfa sıfırlanır** — "all"ın 4. sayfası "tools"un 4. sayfası değildir; boş bir 4. sayfa ziyaretçiye "sonuç yok" diye okunur.

## SEO metnini route yazmaz

`seoInfo` gateway'den gelir ve `parseSeoInfo` ile doğrulanır. Route yalnız kendi bildiğini ekler:
dizinin kaçıncı sayfası olduğu. `generatePaginatedMetadata` canonical'ı, `rel=prev/next`'i ve
sayfa numaralı başlığı buradan üretir. `noindex` kararı da gateway'indir — örneğin mock gateway
filtreli ve derin sayfaları `noindex` işaretler.

## Yeni bir liste sayfası eklerken

1. Sorgu kontratını `src/lib/<sayfa>-query.ts` içinde tanımlayın; normalizer'ları export edin.
2. `src/lib/cache-keys.ts` registry'sinde `contentQuery` olarak **aynı** nesneyi kullanın.
3. Route'ta `resolvePageParam` üçlemesini (invalid / redirect / valid) uygulayın.
4. Sayfa aralığı dışını `notFound()` yapın.
5. `pageCache(id, resolver)` ile geçersiz URL'leri cache dışında bırakın.
6. Filtreleri `Link` ile render edin, `current` prop'unu verin.
7. Testini yazın: allowlist, varsayılan, sayfa sıfırlama, cache-key eşleşmesi.
