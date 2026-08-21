# Mock gateway

OriginLoom uygulamaları production'da gerçek bir **gateway** (upstream API) üzerinden veri alır.
Geliştirme ve test sırasında gateway olmadan çalışabilmek için her uygulama kendi **mock gateway**
fixture'ını taşır.

Mock gateway uygulama process'ine gömülmez: ayrı bir Node.js HTTP servisi olarak çalışır ve
`GATEWAY_URL` üzerinden normal HTTP ile çağrılır. Auth, menü, redirect, sayfa içeriği ve benzeri
kontratları simüle eder; iş mantığı doğruluğundan çok HTTP şekli, payload sınırları ve yaşam döngüsü
kontratlarını temsil eder.

**Ayrı bir `tools/mock-gw/` paketi yoktur.** Konum, uygulamanın nereden geldiğine bağlıdır.

---

## Showroom (monorepo referans uygulaması)

Showroom, platform paketlerinin nasıl kullanılacağını gösteren referans üründür. Mock gateway burada
kalır; `origin-create-app` şablonuna taşınmaz.

|                     |                                                                    |
| ------------------- | ------------------------------------------------------------------ |
| **Konum**           | `apps/showroom/tests/fixtures/gateway/`                            |
| **Giriş**           | `server.js` ve route modülleri                                     |
| **Başlatma**        | Repo kökünden `pnpm mock-gw` veya `pnpm --filter showroom mock-gw` |
| **Varsayılan port** | `4002` (`.env.development` içindeki `GATEWAY_URL`)                 |
| **Dev stack**       | `pnpm dev` mock gateway'i otomatik başlatır                        |

Showroom fixture'ı finans domain'ine özgü geniş bir kontrat seti taşır (menü, kredi kartları, konut
kredisi, piyasa, bilgi merkezi, referral, bot analytics vb.). Bu kasıtlıdır: showroom bir demo
katalogudur, üretilen uygulama iskeleti değildir.

---

## Üretilen uygulama (`origin-create-app`)

Ürün ekiplerinin Nexus/registry'den kurduğu standalone repolar bu yapıyı kullanır.

|                     |                                                                         |
| ------------------- | ----------------------------------------------------------------------- |
| **Konum**           | `mock-gateway/server.mjs` (uygulama kökünde)                            |
| **Başlatma**        | `pnpm dev` (birlikte), `pnpm dev:mock`, `pnpm mock-gw` (yalnız gateway) |
| **Smoke / CI**      | `origin-smoke --gateway mock-gateway/server.mjs`                        |
| **Varsayılan port** | `4002`                                                                  |

Şablon mock gateway'i daha ince bir örnek kontrat setiyle gelir; gerçek gateway payload'larına
uyarlamak ekiplerin ilk görevlerinden biridir (generated `README.md` kontrol listesi).

`--with-ops` ile üretilen `docker-compose.yml`, host üzerinde çalışan mock gateway'e
`host.docker.internal:4002` üzerinden bağlanabilir (`pnpm mock-gw` ayrı terminalde).

---

## Gerçek gateway'e geçiş

1. Staging/production `.env` dosyasında `GATEWAY_URL` gerçek upstream origin'ine ayarlanır.
2. Uygulama kodu ve UI bileşenleri değiştirilmez; `server/services/` kontratları aynı kalır.
3. Mock gateway dosyaları silinmek zorunda değildir — smoke testleri ve yerel geliştirme için
   kalabilir.

---

## Yeni fixture ekleme

Uygulama `server/services/` veya loader'larına **fallback mock veri eklemeyin**. Yeni upstream
cevabı gerekiyorsa:

1. İlgili mock gateway dosyasına route/handler ekleyin (showroom: `tests/fixtures/gateway/routes/`,
   üretilen app: `mock-gateway/server.mjs`).
2. Gateway contract tanımını uygulama tarafında güncelleyin (`defineGatewayContract` — bkz.
   `server/services/gateway-contracts.ts`).
3. Smoke veya contract testleriyle doğrulayın.

---

## İlgili belgeler

- [new-product-app.md](./new-product-app.md) — `create-app` akışı ve kutudan çıkan özellikler
- [create-app-gap.md](./create-app-gap.md) — showroom ile şablon farkı (mock gateway A2 ✅)
- [conventions.md](./conventions.md) — gateway fetch ve payload guard kuralları
