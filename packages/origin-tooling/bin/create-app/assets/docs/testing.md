# Test stratejisi

Bu template üç ayrı hata sınıfını üç ayrı katmanda yakalar:

| Katman        | Komut        | Ne kanıtlar?                                                                                |
| ------------- | ------------ | ------------------------------------------------------------------------------------------- |
| Unit/contract | `pnpm test`  | Route, cache, auth, admission ve ürün fonksiyonları izole çalışıyor.                        |
| Browser E2E   | `pnpm e2e`   | Production bundle gerçek Chromium'da SSR, hydration, ağ ve cookie sınırlarıyla çalışıyor.   |
| Smoke         | `pnpm smoke` | Build edilmiş process health, cache MISS/HIT ve temel public endpoint probe'larını geçiyor. |

`pnpm ci` sırasıyla doctor, typecheck, cycle guard, lint, format, Vitest, Playwright E2E ve smoke
çalıştırır. Playwright'ın `webServer` ayarı production build'i, uygulama process'ini ve mock gateway'i
kendisi yönetir; önceden `pnpm dev` açmayın.

## İlk kurulum

Playwright paketi `pnpm install` ile gelir; Chromium binary'si makine başına bir kez kurulur:

```bash
pnpm e2e:install
pnpm e2e
```

Linux CI/container üzerinde browser'ın sistem paketleri de gerekirse:

```bash
pnpm exec playwright install --with-deps chromium
```

CI yalnız Chromium kurar. Bu bilinçli bir başlangıç bütçesidir; ürün Safari/Firefox kontratı taşıyorsa
`playwright.config.ts` içindeki `projects` listesine WebKit/Firefox ekleyin ve binary'lerini CI'da
kurun.

## Hazır browser senaryoları

`e2e/critical-paths.spec.ts` şu production davranışlarını doğrular:

- enforced CSP/security header ve counter island hydration,
- `308` redirect'te query korunması ve internal rewrite'ta public URL'nin değişmemesi,
- `401 → /api/internal/refresh → tek retry` browser akışı,
- TanStack Query otomatik retry bittikten sonra hata UI'ı ve kullanıcı kontrollü refetch,
- SSE bağlantısının açılması ve sayfadan ayrılınca active-connection lease'inin sıfırlanması,
- HttpOnly credential değerinin SSR HTML'e sızmaması.

`e2e/ssr.no-js.spec.ts`, JavaScript kapalı ayrı bir Chromium project'inde katalog ve detay sayfasının
SSR ile kullanılabildiğini kanıtlar. `e2e/accessibility.spec.ts`, ana içerikte Axe'in serious/critical
ihlallerini release kapısı yapar. Bir ihlali körlemesine disable etmeyin; istisna gerekiyorsa rule id,
etkilenen selector, ürün gerekçesi ve kaldırma tarihiyle dar kapsamlı yazın.

## Test yazma kuralları

- CSS class veya DOM sırasına değil role, accessible name ve görünür ürün davranışına bağlanın.
- Server state'ini beklemek için sabit timeout kullanmayın; `expect.poll`, response veya locator
  bekleyin.
- Üçüncü parti/gateway hatasını `page.route()` ile yalnız test kapsamındaki endpoint'te üretin.
- Browser testinde doğrulanan server sözleşmesinin ucuz edge-case'lerini Vitest'te tutun; bütün hata
  matrisini pahalı E2E katmanına taşımayın.
- Testler birbirinin cookie/cache durumuna güvenmemeli. Playwright her test için izole context açar.
- Auth token'ını test çıktısına, screenshot adına veya assertion mesajına yazmayın.

Yeni kritik ürün akışında en az bir mutlu yol ve kullanıcıya görünen bir failure/recovery yolu ekleyin.
Ödeme/yazma işlemlerinde gerçek mutation'ı tekrar çalıştırmak yerine test gateway'i ve idempotency
kontratını kullanın.

## Çalıştırma ve hata ayıklama

```bash
pnpm e2e                              # headless, tüm project'ler
pnpm e2e -- --project chromium        # JavaScript açık suite
pnpm e2e -- --grep "refreshes"        # tek davranış
pnpm e2e:ui                           # interaktif Playwright UI
pnpm e2e:report                       # son HTML raporu
```

Başarısız CI koşusunda `playwright-report` artifact'ini indirin. İlk retry'da trace; yalnız failure'da
screenshot ve video saklanır. Trace içindeki network ve console zaman çizelgesi genellikle ilk bakış
noktasıdır.

Haricen başlatılmış bir ortamı test etmek için Playwright'ın process yönetimini kapatın:

```bash
E2E_EXTERNAL_SERVER=1 \
E2E_BASE_URL=https://preview.example.com \
pnpm e2e -- --project chromium
```

Bu mod mock gateway veya metrics process'i açmaz. SSE lifecycle testi metrics portuna da eriştiği için
preview ortamında o testi ayrı bir güvenli test topology'sine uyarlayın; public production metrics
endpoint'i açmayın.

## Katmanları büyütme

Starter Vitest suite'i route/cache registry bütünlüğünü, query cache normalizasyonunu, stream global/IP
admission ve idempotent release'i, ayrıca auth kontratını test eder. Ürün geliştirirken gateway payload
rejection/size limit, loader notFound/redirect sonuçları, canonical/JSON-LD, cache vary boyutları,
personal endpoint `no-store`, production config failure, fragment degradation ve graceful shutdown
senaryolarını ekleyin.

Mock gateway fixture'dır; backend'in ikinci implementasyonu değildir. Gerçek backend contract testi
ayrı tutulmalı; fixture yalnız frontend'in deterministik başarı ve hata yollarını üretmelidir.
