# Performance ve accessibility bütçeleri

## CI kapıları

```bash
pnpm build
pnpm budget:bundle
pnpm e2e
pnpm lighthouse
```

`performance-budgets.json`, hydration runtime ve her örnek island için gzip byte sınırı taşır.
`origin-check-budgets` gerçek `dist/client/assets` dosyalarını sıkıştırarak ölçer; eşleşmeyen required
asset veya limit aşımı CI'ı kırar. Yeni island eklerken ayrı bir bütçe kaydı ekleyin. Ortak chunk'ı
island bütçesinden saklamayın; route toplam JavaScript sınırı Lighthouse tarafından ayrıca ölçülür.

`lighthouserc.json`, production bundle'ı mock gateway ile başlatır ve iki route'u ikişer kez ölçer.
Başlangıç eşikleri performance 0.85, accessibility 1.0, LCP 2500 ms, CLS 0.1, TBT 300 ms ve route
başına 160 KB script transferidir. Gürültülü bir sonucu limiti yükselterek susturmayın; raporu
`.lighthouseci/reports` altında inceleyin ve bilinçli baseline değişikliğini review'da açıklayın.
Bu noktayla başlayan gizli bir klasördür. Komut her ölçüm için hem makine tarafından işlenebilir
`.json` hem de tarayıcıda açılabilir `.html` üretir ve tamamlandığında HTML yollarını terminale
yazar. macOS'ta örneğin `open .lighthouseci/reports/home-1.html` ile raporu açabilirsiniz.

Playwright Axe testi serious/critical ihlalleri sıfır bütçesiyle ayrıca kapı yapar. Lighthouse
accessibility skoru bunun yerine geçmez; iki araç farklı regresyon sınıflarını yakalar.

## Gerçek kullanıcı gözlemi

Browser entry, `web-vitals` ile CLS, INP ve LCP'yi bir kez kaydeder. Island runtime başarılı mount
süresini; hata hattı da mount/chunk/timeout source'unu gönderir. Endpoint payload'ları bounded,
query'siz path'e indirgenmiş ve rate-limitlidir.

Prometheus serileri:

- `ssr_client_web_vitals_total{name,rating}`
- `ssr_client_island_mount_duration_milliseconds{island}`
- `ssr_client_runtime_errors_total{source}`
- `ssr_client_metric_ingestion_total{outcome}`

Island failure oranını, island error source'larının rate'ini başarılı mount count + error count'a
bölerek hesaplayın. Web Vital değeri structured log'da tutulur; Prometheus etiketi yalnız bounded
`name/rating` değerleridir, URL veya metric id label yapılmaz.

Server payload bütçeleri, kapasite baseline'ı ve profiling release akışı
[performans kabul politikası](./performance-acceptance.md) dokümanında tanımlıdır.
