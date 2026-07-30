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

`server/seo.ts` sitemap'i gerçek ürün datasından çıkarır ve gateway kesintisi için bounded fallback
taşır. Yeni public route eklerken sitemap, robots disallow ve canonical kararlarını birlikte gözden
geçirin.
