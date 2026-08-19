# Gateway contract drift koruması

Bu proje consumer contract'larını `contracts/openapi.json` içindeki OpenAPI 3.1 / JSON Schema
2020-12 şemalarıyla tanımlar. TypeScript tipleri ve runtime guard'lar kalır; schema bunların backend
ile paylaşılabilen, CI tarafından çalıştırılabilen karşılığıdır.

## Yerel fixture kapısı

```bash
pnpm contracts:fixtures
```

## Yeni endpoint scaffold'u

Ham gateway cevabından fixture, OpenAPI şeması, manifest kaydı, TypeScript tipi ve
`server/services/*` loader iskeleti üretmek için:

```bash
cat response.json | pnpm contracts:scaffold -- \
  --id finance-widgets \
  --path /finance/widgets \
  --operation-id finance.widgets

# veya dosyadan
pnpm contracts:scaffold -- \
  --id finance-widgets \
  --path /finance/widgets \
  --fixture samples/finance-widgets.json

# dosyaları yazmak için
pnpm contracts:scaffold -- ... --apply
```

Komut önce dry-run çıktısı verir; `--apply` ile `contracts/fixtures/*`,
`src/lib/contracts/*`, `server/services/*` ve `gateway-contracts.ts` patch'ini yazar.
Showroom gibi consumer manifest'i olmayan projelerde `--service-only` kullanın.
Scaffold sonrası guard limitlerini, PII'yi ve mock-gateway route'unu gözden geçirin;
ardından `pnpm contracts:fixtures` çalıştırın.

`contracts/gateway-contracts.json` manifest v2 kullanır. Her consumer senaryosunun sabit
`operationId` değerini, request method/path'ini ve beklenen response status/content-type/schema/
fixture eşleşmesini taşır. Fixture schema'yı geçmezse CI kırılır. Yeni endpoint eklerken OpenAPI
schema, manifest kaydı, PII içermeyen fixture ve runtime guard aynı değişiklikte eklenmelidir.

Örneğin progressive HTML demosundaki `/live/message` çağrısı da yalnız bir mock detayı değildir:
`LiveMessage` OpenAPI şeması, `live-message` consumer contract'ı, fixture, byte bütçesi ve
`server/services/live-message.ts` runtime guard'ı birlikte bulunur. Böylece streaming sırasında geç
gelen veri de normal gateway verisiyle aynı güven sınırından geçer.

```json
{
  "id": "item-detail",
  "operationId": "catalog.detail",
  "request": { "method": "GET", "path": "/items/alpha" },
  "response": {
    "status": 200,
    "contentType": "application/json",
    "fixture": "fixtures/item.json",
    "schema": "#/components/schemas/Item"
  }
}
```

Manifest v1 (`path`, `method`, `status`, `fixture`, `schema` alanları contract'ın kökündeyken) tooling
tarafından okunmaya devam eder. Yeni projeler v2 üretir; mevcut manifesti yalnız sürüm yükseltmek için
hemen dönüştürmek gerekmez.

## Staging drift testi

```bash
CONTRACT_BASE_URL=https://staging-gateway.example.com \
CONTRACT_BEARER_TOKEN="$TOKEN" \
pnpm contracts:staging
```

Komut staging payload'ını aynı schema ile doğrular ve fixture'a göre yapısal drift raporu üretir.
Yeni alanlar `added-compatible` olarak raporlanır; eksik required alan, tip/limit ihlali, beklenmeyen
status veya timeout komutu başarısız yapar. Token ve payload değerleri çıktıya yazılmaz.

`.github/workflows/contract-staging.yml` hafta içi scheduled çalışmaya hazırdır. Repository variable
`ENABLE_STAGING_CONTRACT_TESTS=true`, secret olarak `STAGING_GATEWAY_URL` ve gerekiyorsa
`STAGING_GATEWAY_BEARER_TOKEN` tanımlanmadan job çalışmaz.

## Auth profilleri

Manifest v2 secret değeri değil, yalnız environment değişkeninin adını taşır:

```json
{
  "authProfiles": {
    "staging-user": {
      "type": "bearer",
      "tokenEnv": "CONTRACT_USER_BEARER_TOKEN"
    }
  }
}
```

Bir contract `request.auth` ile bu profile bağlanır. Değişken yalnız staging isteği yapılırken
zorunludur; fixture kontrolü secretsız çalışır. Güvenlik için env adı `CONTRACT_` ile başlamalıdır ve
token rapora yazılmaz. `Authorization` ve `Cookie` doğrudan header olarak tanımlanamaz; kimlik bilgisi
auth profili üzerinden verilmelidir.

## Request body ve endpoint header'ları

POST/PUT/PATCH/DELETE senaryolarında gönderilecek JSON da fixture ve schema ile doğrulanır:

```json
{
  "id": "refresh-success",
  "operationId": "auth.refresh",
  "request": {
    "method": "POST",
    "path": "/auth/refresh",
    "auth": "staging-user",
    "headers": {
      "x-contract-client": { "value": "originloom" },
      "x-api-key": { "env": "CONTRACT_API_KEY" }
    },
    "body": {
      "fixture": "fixtures/requests/refresh.json",
      "schema": "#/components/schemas/RefreshRequest",
      "contentType": "application/json",
      "envBindings": {
        "/refreshToken": "CONTRACT_REFRESH_TOKEN"
      }
    }
  },
  "response": {
    "status": 200,
    "contentType": "application/json",
    "fixture": "fixtures/refresh-response.json",
    "schema": "#/components/schemas/TokenResponse"
  }
}
```

`value` yalnız gizli olmayan sabit header'lar içindir. Secret header'lar `env` ile bağlanır.
`envBindings`, request fixture içindeki mevcut bir JSON Pointer alanını staging sırasında environment
değeriyle değiştirir; fixture dosyasına gerçek token yazılmaz. Bağlanan değer string'dir ve request
gönderilmeden önce schema tekrar çalıştırılır. GET ve HEAD request body kabul etmez.

Yerel `contracts:fixtures` çalışması request ve response fixture'larını secretsız doğrular.
`contracts:staging` ise gerekli `CONTRACT_*` değerlerinden biri eksikse hangi environment değişkeninin
eksik olduğunu söyler; değerin kendisini çıktıya yazmaz.

## Hata ve body içermeyen response senaryoları

Aynı `operationId` için başarı ve hata davranışlarını ayrı, benzersiz `id` değerleriyle tanımlayın:

```json
{
  "id": "profile-unauthorized",
  "operationId": "auth.profile",
  "request": { "method": "GET", "path": "/user/profile" },
  "response": {
    "status": 401,
    "contentType": "application/json",
    "fixture": "fixtures/unauthorized.json",
    "schema": "#/components/schemas/ErrorResponse"
  }
}
```

204 gibi gövdesiz response için fixture/schema yazılmaz: `"response": { "status": 204 }`. Staging
cevabı beklenen status'ta olsa bile gövde içerirse kontrol başarısız olur. Response fixture varsa
`schema` ve `fixture` birlikte verilmelidir; `contentType` yalnız gövdeli response'ta kullanılabilir.

## Uyumluluk politikası

- Optional alan eklemek backward-compatible'dır; runtime bilinmeyen alanı yok saymalıdır.
- Required alan eklemek, required alanı kaldırmak veya alan tipini değiştirmek breaking change'dir.
- Enum'a değer eklemek consumer switch'i exhaustive ise breaking kabul edilir; önce consumer güncellenir.
- Alan kaldırma iki aşamalıdır: consumer kullanımı ve required kaydı kaldırılır, staging gözlenir, sonra
  provider alanı kaldırır.
- Büyük payload artışı schema geçse bile endpoint'in `GatewayContracts` byte bütçesini ayrıca gözden
  geçirmeyi gerektirir; bütçe otomatik yükseltilmez.

Provider OpenAPI artifact'ı merkeziyse bu dosyayı CI'da indirin veya kontrollü codegen ile güncelleyin;
runtime sırasında uzaktaki schema'ya güvenmeyin. Schema değişikliği code review'da görünür kalmalıdır.
