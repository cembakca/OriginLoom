# Metadata ve SEO

Site defaults `src/lib/metadata/site-defaults.ts`, route metadata ise `defineRoute.generateMetadata`
içindedir. Canonical ve Open Graph URL'leri public site URL'inden üretilir; gateway URL'si browser'a
sızdırılmaz.

CMS/gateway SEO JSON'u TypeScript cast'iyle güvenilir olmaz. Uzunluk ve URL sınırları olan runtime
schema ile doğrulayın. Liste sayfalarında normalize edilmiş page/filter değerlerinden canonical
üretin; geçersiz page'i redirect/notFound sonucu olarak loader'da çözün. Tracking parametreleri
canonical'a girmez.

JSON-LD için `breadcrumbJsonLd`, `itemListJsonLd` ve `compactJsonLd` yardımcılarını kullanın. JSON-LD
node'ları loader'ın doğrulanmış datasından üretilmeli; HTML string birleştirmeyin. Indexlenmeyen veya
hata sayfasına structured data eklemeyin.

`server/seo.ts` sitemap'i **gateway'e sorar** (`server/services/sitemap.ts`), kendi verisinden
türetmez: bir sayfalık katalogdan üretilen sitemap, katalog o sayfayı aştığı anda sitenin geri
kalanını sessizce dışarıda bırakır — hatasız, logsuz. Dönen her entry bu siteye ait public bir path
olmak zorundadır; `//baska-host/...`, query, fragment ve kontrol karakteri reddedilir. Gateway
kesintisi için bounded fallback vardır.

Liste sayfalarında canonical ve `rel=prev/next` kararı `generatePaginatedMetadata`'ya aittir;
`seoInfo` (başlık, açıklama, `noindex`) gateway'den gelir. Ayrıntı: [lists.md](./lists.md).

Yeni public route eklerken sitemap, robots disallow ve canonical kararlarını birlikte gözden
geçirin.
