# ssr-kit mock gateway

Bağımsız, dependency içermeyen Node.js geliştirme gateway'idir. Varsayılan olarak `4002`
portunda çalışır:

```bash
npm run mock-gw
```

Günlük geliştirmede `npm run dev` mock gateway'i otomatik başlatır; cache in-memory çalışır,
Redis gerekmez. Redis/SWR testi için `npm run dev:redis` kullanın.

Uygulama runtime'ı fixture veya mock fallback içermez. Local geliştirme ve Docker Compose
`GATEWAY_URL` üzerinden bu servise bağlanır; gerçek gateway geldiğinde URL değiştirmek yeterlidir.

| Method | Endpoint                                | Amaç                                      |
| ------ | --------------------------------------- | ----------------------------------------- |
| GET    | `/healthz`                              | Liveness                                  |
| POST   | `/auth/login`                           | Test access/refresh üretir                |
| POST   | `/auth/refresh`                         | Refresh token rotation                    |
| GET    | `/user/profile`                         | Bearer token profil doğrular              |
| GET    | `/account/summary`                      | Korumalı hesap özeti                      |
| GET    | `/pages/menuitem/list`                  | Header/footer menüsü                      |
| GET    | `/routing/domains`                      | Route iş-domain snapshot'ı                |
| GET    | `/pages/retirement-banking`             | Sayfa + SEO içeriği                       |
| GET    | `/cms/redirects?path=...`               | Redirect/gone kuralı                      |
| GET    | `/offers?...`                           | Eski ihtiyaç kredisi teklif kontratı      |
| GET    | `/blogs?...`                            | Eski teknik blog örnekleri                |
| GET    | `/finance/housing-loans?...`            | Konut kredisi filtreleme ve pagination    |
| GET    | `/finance/housing-loans/:slug?...`      | Konut kredisi detay ve ödeme örneği       |
| GET    | `/finance/credit-cards?...`             | Kredi kartı filtreleme ve pagination      |
| GET    | `/finance/credit-cards/:slug`           | Kart detayı ve kampanyalar                |
| GET    | `/finance/credit-cards/:slug/campaigns` | Karta ait kampanya listesi                |
| GET    | `/finance/referrals/:productType/:slug` | Başvuru öncesi ürün/yasal bilgilendirme   |
| POST   | `/finance/referrals`                    | Kısa ömürlü başvuru yönlendirmesi         |
| GET    | `/internal/referrals/stats`             | Server-side referral sayı/latency özeti   |
| GET    | `/content/articles?...`                 | Bilgi Merkezi filtreli içerik listesi     |
| GET    | `/content/articles/:slug`               | Finansal makale detayı ve ilişkili içerik |
| GET    | `/markets/bist100?...`                  | BIST 100 tarzı hisse listesi              |
| GET    | `/internal/markets/stream`              | Token korumalı SSE quote batch akışı      |
| POST   | `/analytics/bot`                        | Bounded bot event batch sink              |

`/blogs` SSR-kit'in teknik blog örneklerini korur. `/content/articles` ise tüketici finansmanı,
kredi kartları, konut kredileri ve yatırım okuryazarlığı için ayrı bir **Bilgi Merkezi**
kontratıdır. Böylece UI aşamasında iki içerik ürününün bilgi mimarisi ve görsel dili bağımsız
tasarlanabilir.

Liste endpointleri `page` ve `pageSize` yanında kendi domain filtrelerini kabul eder. Örneğin konut
kredilerinde `amount`, `term`, `city`, `bank` ve `sortBy`; kredi kartlarında `cardType`, `annualFee`,
`network` ve `sortBy`; piyasalarda `sector`, `q` ve `sortBy` kullanılabilir.

Bu servis gerçek bir IAM veya içerik gateway'i değildir; yalnızca uygulamanın HTTP
sözleşmelerini uçtan uca çalıştırmak için deterministik cevaplar verir.

Referral sayaçları client'tan kabul edilmez. `POST /finance/referrals` işlendiğinde mock gateway
toplam yönlendirme, anonim session ve gateway işlem süresini process belleğinde kaydeder. Bu mock
persist etmez ve horizontal scale için tasarlanmamıştır; gerçek gateway aynı kontratı kalıcı bir event
store/metric backend ile uygulamalıdır. Ölçülen olay bankaya `redirect-issued` kararıdır; gerçek landing
ve başvuru sonucu ancak banka callback'iyle doğrulanabilir.

Kredi şehirleri ve başvuru sayfaları gibi iş-domain değerlerinin kaynağı deployment env'i
değildir. Mock geliştirme ortamında `/routing/domains` bu sahipliği temsil eder; gerçek sistemde
aynı kontrat gateway veya CMS tarafından beslenir.

Canlı piyasa endpoint'i public browser endpoint'i değildir. `MARKET_STREAM_TOKEN` bearer token'ı ile
BFF tarafından açılır, en fazla 100 doğrulanmış sembol kabul eder ve monotonic sequence taşıyan bounded
quote batch'leri üretir. Browser yalnız UI uygulamasındaki aynı-origin `/api/markets/stream` kanalını
görür.
