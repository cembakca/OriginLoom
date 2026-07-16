# Cache Purge API

Uygulama cache'ini (HTML + menü) HTTP API ile yönetmek için internal endpoint'ler.

> **Erişim:** Endpoint'ler `/api/internal/*` altındadır. Production'da ağ seviyesinde (VPC, ingress allowlist, API gateway) kısıtlaman önerilir. Ek olarak `CACHE_PURGE_SECRET` ile token doğrulaması vardır.

---

## Kimlik doğrulama

Production ortamında `CACHE_PURGE_SECRET` env değişkeni **zorunludur**. İsteklerde aşağıdaki yöntemlerden biri kullanılır:

```http
Authorization: Bearer <CACHE_PURGE_SECRET>
```

veya

```http
X-Cache-Purge-Token: <CACHE_PURGE_SECRET>
```

| Ortam                 | Secret yoksa                                         |
| --------------------- | ---------------------------------------------------- |
| `NODE_ENV=production` | `503` — purge devre dışı                             |
| Geliştirme            | Secret olmadan da çalışır (yalnızca local test için) |

### Env

```bash
CACHE_PURGE_SECRET=uzun-rastgele-bir-deger   # prod'da zorunlu
```

Docker Compose örneği:

```yaml
environment:
  CACHE_PURGE_SECRET: ${CACHE_PURGE_SECRET}
```

---

## Key formatı

API'de kullanılan key'ler **mantıksal key**'lerdir — Redis'teki `ssr:<release-id>:` namespace'ini yazmazsın.

| Tür            | Mantıksal key örneği | Ne cache'ler                                |
| -------------- | -------------------- | ------------------------------------------- |
| Menü           | `menu:Desktop`       | Gateway menü JSON                           |
| HTML           | `home\0tr\0desktop`  | SSR sayfa HTML (parçalar `\0` ile birleşir) |
| HTML (okunur)  | `entries[].display`  | Debug — silme için kullanma                 |
| HTML (güvenli) | `entries[].encoded`  | base64url — purge için kopyala              |

Key'leri keşfetmek için list endpoint'ini kullan.

### `\0` ayırıcı ve silme sorunu

HTML key'leri parçaları **görünmez null karakter** (`\0`) ile birleştirir. `keys` dizisinden kopyalayınca ayırıcılar kaybolur; query param'lı sayfalarda silme başarısız olur.

| Mod           | Örnek                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `pageIds`     | `{"pageIds": ["blogs-paginated"]}` — tüm page/locale/device varyantları |
| `prefix`      | `{"prefix": "loan"}`                                                    |
| `keysEncoded` | list → `entries[].encoded` kopyala                                      |

### Neden tüm sayfalar listede görünmüyor?

Cache key'leri **lazy** oluşur — önceden tanımlı bir “key havuzu” yoktur.

| Durum                             | Listede görünür mü?            |
| --------------------------------- | ------------------------------ |
| Sayfa hiç anonim ziyaret edilmedi | Hayır                          |
| Oturumlu istek (BYPASS)           | Hayır — write yapılmaz         |
| `neverCache()` route (`/hesabim`) | Hayır                          |
| İlk anonim MISS sonrası           | Evet                           |
| Menü (`menu:*`)                   | Layout render edildikten sonra |

`CACHE_BACKEND=memory` iken key'ler process belleğindedir; restart sonrası liste boşalır. Production'da `CACHE_BACKEND=redis` ile tüm instance'lar aynı key setini paylaşır — yine de yalnızca gerçekten yazılmış entry'ler listelenir.

Registry referansı (hangi prefix'lerin olması beklendiği): [`src/lib/cache-keys.ts`](../src/lib/cache-keys.ts) → `listPageCachePrefixes()`.

---

## Endpoint'ler

### `GET /api/internal/cache/keys`

Cache'teki key'leri listeler (sayfalı).

**Query parametreleri:**

| Parametre | Varsayılan | Açıklama                          |
| --------- | ---------- | --------------------------------- |
| `prefix`  | —          | Key prefix filtresi (ör. `menu:`) |
| `limit`   | `50`       | Sayfa boyutu (max 200)            |
| `cursor`  | —          | Sonraki sayfa (Redis SCAN cursor) |

**Örnek:**

```bash
curl -s \
  -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  "http://localhost:3005/api/internal/cache/keys?prefix=menu:&limit=10"
```

**Yanıt:**

```json
{
  "ok": true,
  "keys": ["menu:Desktop"],
  "entries": [
    {
      "key": "menu:Desktop",
      "encoded": "bWVudTpEZXNrdG9w",
      "parts": ["menu:Desktop"],
      "display": "menu:Desktop"
    }
  ],
  "backend": "redis"
}
```

Query param'lı HTML key örneği:

```json
{
  "key": "blogs-paginated\u0000/blogs/paginated\u00001\u0000en\u0000Desktop",
  "encoded": "YmxvZ3MtcGFnaW5hdGVk...",
  "parts": ["blogs-paginated", "/blogs/paginated", "1", "en", "Desktop"],
  "display": "blogs-paginated::/blogs/paginated::1::en::Desktop"
}
```

Silme için `encoded` alanını `keysEncoded` modunda kullan veya `pageIds: ["blogs-paginated"]` gönder.

Redis'te daha fazla key varsa:

```json
{
  "ok": true,
  "keys": ["..."],
  "nextCursor": "42",
  "backend": "redis"
}
```

Sonraki sayfa:

```bash
curl -s \
  -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  "http://localhost:3005/api/internal/cache/keys?prefix=menu:&cursor=42"
```

---

### `POST /api/internal/cache/purge`

Cache entry'lerini siler. Body'de **tam olarak bir mod** seç:

#### Mod 1 — Tek tek key sil (`keys` veya `keysEncoded`)

Menü gibi `\0` içermeyen key'ler için `keys`:

```bash
-d '{"keys": ["menu:Desktop", "menu:Mobile"]}'
```

HTML key'ler için list'ten `encoded` kopyala:

```bash
-d '{"keysEncoded": ["YmxvZ3MtcGFnaW5hdGVk..."]}'
```

**Yanıt:**

```json
{
  "ok": true,
  "mode": "keys",
  "deleted": 2,
  "keys": ["menu:Desktop", "menu:Mobile"],
  "backend": "redis"
}
```

En fazla **500 key** tek istekte silinebilir.

#### Mod 2 — Sayfa kimliği ile sil (`pageIds`) — önerilen

Registry'deki `PageCacheId` — o sayfanın **tüm** locale/device/query varyantlarını siler:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"pageIds": ["blogs-paginated", "loan"]}' \
  http://localhost:3005/api/internal/cache/purge
```

**Yanıt:**

```json
{
  "ok": true,
  "mode": "pageIds",
  "deleted": 3,
  "pageIds": ["blogs-paginated", "loan"],
  "backend": "redis"
}
```

#### Mod 3 — Prefix ile sil

Prefix'e uyan tüm key'leri siler:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "menu:"}' \
  http://localhost:3005/api/internal/cache/purge
```

**Yanıt:**

```json
{
  "ok": true,
  "mode": "prefix",
  "deleted": 3,
  "prefix": "menu:",
  "backend": "redis"
}
```

Yaygın prefix'ler (`pageCacheRegistry` ilk segment):

| Prefix                   | Etki                          |
| ------------------------ | ----------------------------- |
| `menu:`                  | Tüm cihaz menü cache'leri     |
| `home`                   | Ana sayfa HTML varyantları    |
| `loan`                   | İhtiyaç kredisi karşılaştırma |
| `blogs-paginated`        | Blog listesi                  |
| `retirement-banking`     | Emekli bankacılığı            |
| `remote-customer-obtain` | Uzaktan müşteri edinimi       |
| `recourse-redirect`      | Başvuru yönlendirme           |

Tam liste: `listPageCachePrefixes()` — [`src/lib/cache-keys.ts`](../src/lib/cache-keys.ts).

#### Mod 4 — Tüm cache'i sil

Aktif release'in `ssr:<release-id>:` namespace'i altındaki **tüm** entry'leri siler (HTML + menü + diğer):

```bash
curl -s -X POST \
  -H "Authorization: Bearer $CACHE_PURGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"all": true}' \
  http://localhost:3005/api/internal/cache/purge
```

**Yanıt:**

```json
{
  "ok": true,
  "mode": "all",
  "deleted": 47,
  "backend": "redis"
}
```

> Redis'te yalnızca aktif `ssr:<release-id>:*` pattern'i silinir — `FLUSHDB` kullanılmaz; başka uygulamalar ve diğer release'ler etkilenmez.

---

## Hata kodları

| HTTP  | Anlam                                                |
| ----- | ---------------------------------------------------- |
| `200` | Başarılı                                             |
| `400` | Geçersiz body (eksik mod, boş keys, wildcard prefix) |
| `401` | Token hatalı veya eksik                              |
| `503` | Production'da `CACHE_PURGE_SECRET` tanımlı değil     |

**Hata örneği:**

```json
{ "error": "all, keys veya prefix alanlarından biri gerekli" }
```

---

## Operasyon senaryoları

### Menü güncellendi (CMS)

```bash
# 1. Mevcut menü key'lerini kontrol et
curl -s -H "Authorization: Bearer $SECRET" \
  "$HOST/api/internal/cache/keys?prefix=menu:"

# 2. Menü cache'ini temizle
curl -s -X POST -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "menu:"}' \
  "$HOST/api/internal/cache/purge"
```

Sonraki anonim istek menüyü GW'den tekrar çeker.

### Belirli sayfa yayınlandı

Route cache key tanımı [`src/lib/cache-keys.ts`](../src/lib/cache-keys.ts) registry'sindedir — örneğin ana sayfa:

```ts
pageCachePolicy(PageCacheId.home, ctx);
// buildKey → ["home", locale, layoutCacheFragment]
```

Key listesinden tam key'i bul veya prefix ile dene:

```bash
curl -s -H "Authorization: Bearer $SECRET" \
  "$HOST/api/internal/cache/keys?prefix=home"

curl -s -X POST -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"keys": ["home\u0000tr\u0000desktop"]}' \
  "$HOST/api/internal/cache/purge"
```

JSON'da `\u0000` null ayırıcıdır.

### Deploy sonrası tam temizlik

```bash
curl -s -X POST -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"all": true}' \
  "$HOST/api/internal/cache/purge"
```

### Purge sonrası doğrulama

Anonim istek at (cookie/token olmadan):

```bash
curl -sI http://localhost:3005/ | grep -i x-cache
# x-cache: MISS  → cache temiz, yeni render
# İkinci istek: x-cache: HIT
```

---

## CI / webhook entegrasyonu

CMS veya deploy pipeline'dan örnek:

```bash
#!/usr/bin/env bash
set -euo pipefail

HOST="${SSR_HOST:-https://www.hangikredi.com}"
SECRET="${CACHE_PURGE_SECRET:?}"

# Menü + ana sayfa prefix purge
curl -sf -X POST \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "menu:"}' \
  "${HOST}/api/internal/cache/purge"

curl -sf -X POST \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"prefix": "home"}' \
  "${HOST}/api/internal/cache/purge"
```

---

## İlgili dosyalar

| Dosya                                | Rol                       |
| ------------------------------------ | ------------------------- |
| `server/api/internal/cache-purge.ts` | HTTP handler + auth       |
| `server/cache/purge.ts`              | Purge mantığı, body parse |
| `server/cache/redis.ts`              | Redis SCAN + DEL          |
| `server/cache/memory.ts`             | Bellek store purge        |
| `src/lib/cache-keys.ts`              | Cache key registry        |
| `server/config.ts`                   | `CACHE_PURGE_SECRET`      |

Genel cache mimarisi: [`conventions.md`](./conventions.md#redis-ve-cache-altyapısı)
