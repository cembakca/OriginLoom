# Ekosistem backlog'u

OriginLoom bugün bir **çekirdek + template**. Ekosistem, "her ürün ekibinin sıfırdan yazdığı entegrasyon"u
"platformun bir kez çözdüğü, ürünün seçtiği" hale getirmektir. Bu belge ne yapılabileceğini, hangi
şekilde yapılacağını ve önce platformda neyin var olması gerektiğini listeler. Sıra bir taahhüt değil,
bir tartışma zeminidir.

## 0. Önce mekanizma: eklenti nedir?

i18n bunun ilk örneği: `--i18n` ile üretilir, üretilmezse uygulamada tek satırı bulunmaz, `docs/i18n.md`
kaldırma adımlarını yazar. Aynı kalıp tekrarlanabilir olduğunda ekosistem mümkün olur. Şu an eksik olan:

- **Eklenti kaydı.** Bugün `templates.mjs` içinde koşullar var. On eklentide bu dosya okunamaz hale
  gelir. `plugins/<ad>/{files.mjs,patches.mjs,doc.md,skill.md}` gibi bir klasör sözleşmesi gerekir.
- **Patch sözleşmesi.** Bir eklenti paylaşılan bir dosyaya (route tablosu, middleware listesi, cache
  registry) satır eklemek zorunda. Bugün bu, template içinde string birleştirme. Sözleşmeli hale
  gelmeli: "şu bloğa şu satırı ekle", çakışırsa üretim hata versin.
- **Eklenti testi.** Her eklenti için: kapalıyken iz bırakmadığı, açıkken `pnpm ci`'dan geçtiği.
  `create-app-templates.test.mjs` içindeki i18n testi bunun şablonu.
- **Upgrade etkisi.** Üretilen dosyalar uygulamaya aittir; eklenti güncellemesi otomatik gelmez.
  Ya eklentiler paket haline gelir (kod platformda, üretilen dosya ince bir wiring olur) ya da
  migration'lar eklenti-farkında olur. **Bu karar diğer her şeyden önce gelir.**

Sonraki tüm maddeler bu üç şeyden birine düşer: **paket** (kod platformda), **eklenti** (kod üretilen
uygulamada), **rehber** (yalnız doküman + skill).

---

## Kaldırıldı: i18n — _ve nedeni_

Eklenti mekanizmasının ilk örneği olarak yazıldı, değerlendirildi ve **template'ten tamamen
kaldırıldı** (`f6a6be1`, `1e2b1df` commit'lerinde tarihte duruyor). Çalışan kısmı vardı: URL modeli
(varsayılan dil öneksiz, diğerleri önekli), dil başına cache bölme, hreflang, dil değiştirici, dile
göre menü.

Çalışmayan kısmı, gerçek bir sitenin tam olarak dayandığı yerler:

1. **Routing kuralları dili görmüyor.** Redirect'ler rewrite'lardan önce çalıştığı ve locale öneki
   bir rewrite kuralı olarak kurulduğu için `/en/old-catalog` redirect kuralına hiç uğramıyor;
   `/en/products/alpha` de tek geçişli rewrite yüzünden alias kuralına ulaşamıyor. İkisi de 404.
2. **CMS redirect haritası** önekli path'i soruyor (`/en/legacy-catalog`), harita öneksiz tutuyor.
3. **Route'ların elle yazdığı canonical'lar** öneksiz kalıyor: `/en/catalog` sayfası canonical olarak
   Türkçe sayfayı gösteriyor — arama motoruna "bu sayfayı indexleme" demenin en net yolu.
4. **Island'lar** locale context'ini görmüyor ve hata vermeden varsayılan dile düşüyor.

Kök neden tasarımda: locale önekini bir routing **kuralı** yaptım, oysa kuralların **üstünde** bir
katman. Doğru yer routing motoru — `configureRouting({ …, locales })` öneki eşleşmeden önce soyar,
hatırlar ve redirect hedefine geri ekler; (1) ve (2) birlikte kapanır, ürün kuralları öneksiz
yazılmaya devam eder. (3) template'te canonical'ı elle kurmayı bırakmak, (4) request context'ini
island'lara da taşımaktır.

Kod parkta tutulmadı: erişilemeyen bir dal her template değişikliğinde sessizce çürür ve her
düzenlemede ikinci bir varyantı düşünmeyi gerektirirdi. Yeniden ele alınırsa doğru başlangıç
noktası şudur — **locale routing motoruna girer**, template'e değil.

Platformda bırakılanlar (küçük, bağımsız olarak da doğru): `PageMetadata.languageAlternates` ve onu
`<link rel="alternate" hreflang>` olarak basan head render'ı; `DocumentShell.htmlLang`'in istek
başına çözülebilmesi. İkisi de elle çok dillilik yapan bir uygulamanın işine yarar ve gelecekteki bir
i18n'in core'da ihtiyaç duyacağı primitiflerdir.

---

## 1. Auth sağlayıcıları — _eklenti_

Bugün: cookie tabanlı JWT + gateway refresh, BFF deseniyle. Kendi auth backend'i olmayan bir ürün için
karşılığı yok.

| Aday                                   | Şekil                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| OIDC / OAuth2 (Keycloak, Auth0, Entra) | Authorization code + PKCE akışı, `server/api/auth/*`, mevcut httpOnly cookie modeline oturur |
| SAML                                   | Kurumsal müşteri gereksinimi; ayrı bir eklenti, muhtemelen gateway tarafında                 |
| Magic link / OTP                       | Mutation guard'ı + rate limit zaten var; üstüne token üretimi                                |

Önce platformda gereken: `auth/bff.ts`'in sağlayıcıdan bağımsız hale gelmesi (bugün gateway'in
`/auth/refresh` kontratına gömülü). Bir `AuthProvider` kontratı — `refresh`, `verify`, `logout`.

## 2. CMS — _eklenti + rehber_

Bugün: gateway'den `/cms/redirects` ve sayfa içeriği bekleniyor; hangi CMS olduğu belirsiz.

- **Headless CMS adaptörleri** (Strapi, Contentful, Sanity, Storyblok): içerik tipi → route + cache
  kaydı üretimi. En büyük kazanç burada değil aslında: **preview modu**. Taslak içeriği görmek,
  cache'i bozmadan, yalnız yetkili kullanıcıya. Bu platform tarafında bir kontrat ister:
  `values: { preview: "1" }` + `cacheVary` zaten var, üstüne imzalı preview cookie'si.
- **Görsel editör / live preview**: iframe içinde SSR sayfası + postMessage. Cache ile ilişkisi
  düşünülmeden yapılırsa üretim cache'ini kirletir.

## 3. Arama — _eklenti_

Algolia / Meilisearch / Elastic. Üç parça: indeksleme (route manifest'ten beslenebilir), sorgu ucu
(mutation guard'ının kardeşi: rate limit + bounded input), sonuç sayfası (cache'lenmez, `q` parametresi
cache key'e **girmemeli** — sınırsız değer).

Platformda gereken: yok. Bugünkü kontratlarla yazılabilir. Bu yüzden ilk eklenti adaylarından biri.

## 4. Ödeme ve sepet — _eklenti_

Stripe / iyzico / PayTR. Kritik nokta: webhook. İmza doğrulama, idempotency, replay koruması ve
"cevap vermeden önce işi bitirme" sorunu. Bugün `mounts.api` altında elle yazılabilir ama her ekip
aynı hataları yapar.

Platformda gereken: **webhook ucu için ayrı bir guard** (`guardWebhook`: imza doğrulama + body'yi ham
okuma + rate limit'siz ama IP allowlist'li) ve idempotency anahtarı için cache API'sinin küçük bir
sarmalayıcısı.

## 5. Feature flag ve deney — _eklenti_

Middleware `values` + `cacheVary` bunun altyapısını zaten kuruyor: bir deney kovası cache key'ini
otomatik böler. Eksik olan sağlayıcı entegrasyonu (Unleash, GrowthBook, LaunchDarkly) ve **kova
sayısının cache maliyetini** görünür kılan bir uyarı: `pnpm build` özeti "bu sayfa 3 boyutla 12
entry'ye bölünüyor" diyebilmeli.

## 6. Görsel ve CDN — _paket_

Bugün: `origin-build-media`, `ResponsiveImage`, `IMAGE_CDN_URL`/`IMAGE_TRANSFORM_URL`. Eksik:
Cloudinary/imgix/Cloudflare Images gibi sağlayıcıların URL şemaları için adaptör; bugün tek bir
şema varsayılıyor. `MediaProvider` kontratı — `url(src, {w,h,format})`.

## 7. E-posta ve bildirim — _rehber_

Transactional e-posta (Postmark, SES, Resend). Bir SSR framework'ünün bunu kendi içinde çözmesi
gerekmez; gereken, **background worker** kalıbının belgelenmesi: `onBotVisit` extension point'i
bounded queue örneğini zaten taşıyor, e-posta kuyruğu aynı şekil.

## 8. Kuyruk ve zamanlanmış iş — _paket_

Bugün: yalnız istek içi iş ve bounded drain. Yok olan: cron, retry'lı job, dead letter. Kubernetes
CronJob + ayrı bir entrypoint bugün mümkün ama kontratı yok.

Platformda gereken: `defineJob({ name, schedule, run })` ve `origin-run-job` bin'i; metrics ve
graceful shutdown ile aynı disipline bağlı olmalı.

## 9. Veri katmanı — _karar_

Bugün her şey HTTP gateway varsayıyor. Doğrudan Postgres'e giden bir ürün için desen yok. İki yol:

- **Kapsam dışı ilan et.** "OriginLoom gateway önünde bir SSR katmanıdır." Net, savunulabilir.
- **`DataSource` kontratı ekle.** Deadline, contract bütçesi, cache ve metrics disiplini DB
  çağrılarına da uygulanır. Daha büyük iş, daha geniş ürün yelpazesi.

**Bu karar verilmeden 15 ürüne yayılmak riskli.**

## 10. Design system entegrasyonu — _rehber_

Tailwind kurulu geliyor; kurumsal bir design system paketi (kendi bileşenleriniz) nasıl bağlanır,
Tailwind `@source` taraması, island'larda tema — bunlar bugün her ekibin kendi bulduğu şeyler.
Kod değil doküman gerektirir.

## 11. Gözlemlenebilirlik entegrasyonları — _rehber_

OTel export'u ve Prometheus var. Eksik: Grafana dashboard JSON'ları, alert kuralları (showroom'da
`k8s/prometheus-rules.yaml` var — bu genelleştirilebilir), Sentry benzeri hata toplama için
`onClientError` bağlantısı.

## 12. Deploy hedefleri — _eklenti_

Bugün: Dockerfile + k8s manifestleri (`--with-ops`). Eklenebilir: ECS/Fargate, Cloud Run, Fly.io,
bare-metal systemd. Her biri `--with-ops` gibi opt-in bir dosya kümesi.

---

## Sıralama önerisi

1. **Eklenti mekanizmasını sözleşmeye bağla** (§0) — bunsuz her ekleme `templates.mjs`'i büyütür.
2. **Veri katmanı kararını ver** (§9) — kapsamı belirler.
3. **Arama** (§3) — platformda değişiklik gerektirmeyen, en temiz ikinci eklenti örneği.
4. **CMS preview** (§2) — `values`/`cacheVary` kontratının en değerli kullanımı ve gerçek bir talep.
5. **Webhook guard'ı** (§4) — ödeme olmadan da gereken, güvenlik değeri yüksek bir platform parçası.
6. Gerisi talebe göre.

## Ölçüt

Bir şeyin ekosisteme girip girmeyeceğini belirleyen soru: **iki üründe aynı hatayı yapma ihtimali
var mı?** Varsa platforma; yoksa rehbere. Cache'i bozmak, guard'ı unutmak, webhook imzasını
doğrulamamak — bunlar platform işi. Hangi CMS'i seçtiğiniz değil.
