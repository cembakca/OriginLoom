# Auth ve cache-safe kişiselleştirme

Paylaşılan SSR HTML kullanıcı adı, token veya session verisi içermez. Kişisel bölüm `defer` island
olarak mount olur ve same-origin BFF'ye gider. Access ve refresh token'ları HttpOnly cookie'de kalır;
browser JavaScript'i token görmez.

## Akış

1. `account-panel` `/api/session` çağırır.
2. BFF `authenticateBffRequest` ile cookie oturumunu gateway request'ine çevirir.
3. Başarılı cevap UI bilgisini döndürür ve auth cookie durumunu doğrular.
4. Korumalı bir API `401` döndürürse `clientApiFetch`, `/api/internal/refresh` çağırıp yalnız bir kez
   retry eder.
5. Refresh de `401` ise kullanıcı signed-out olur. Gateway `5xx` ise session silinmez; durum
   `unavailable` olarak gösterilir.

## Local cookie ile deneme

`pnpm dev`, `mock-gateway/server.mjs` dosyasını `127.0.0.1:4002` üzerinde otomatik başlatır. Cookie'leri
tarayıcının Application/Storage panelinden `http://127.0.0.1:3010` origin'i için ekleyin. `localhost`
ile `127.0.0.1` farklı cookie origin'leridir; uygulamayı hangi host ile açtıysanız cookie'yi aynı hosta
ekleyin.

| Cookie          | Değer                            | Path | HttpOnly | Secure (HTTP local) |
| --------------- | -------------------------------- | ---- | -------- | ------------------- |
| `access_token`  | Aşağıdaki JWT değerlerinden biri | `/`  | Evet     | Hayır               |
| `refresh_token` | `dev-refresh-token`              | `/`  | Evet     | Hayır               |

Access token hâlâ geçerliyken doğrudan profil çağrısını denemek için:

```text
eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJkZW1vIiwiZXhwIjo0MTAyNDQ0ODAwfQ.dev
```

Bu senaryoda `refresh_token` zorunlu değildir. Refresh akışını özellikle denemek için expired access
token ile development refresh token'ını birlikte ekleyin:

```text
access_token=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJkZW1vIiwiZXhwIjoxfQ.dev
refresh_token=dev-refresh-token
```

Sonra `/account` sayfasını açın veya `GET /api/session` çağırın. BFF expired access token'ı görür,
mock gateway'deki `POST /auth/refresh` endpoint'inden bir saat geçerli yeni access token alır ve her
iki HttpOnly cookie'yi `Set-Cookie` ile yeniler. `signed_in` ve `account_text` cookie'lerini elle
eklemeyin; başarılı, otoritatif profil cevabından sonra BFF bunları kendisi üretir.

Kontrol için mock gateway'e doğrudan şu istek atılabilir:

```bash
curl http://127.0.0.1:4002/auth/refresh \
  -H 'content-type: application/json' \
  --data '{"refreshToken":"dev-refresh-token"}'
```

Production'da bu development değerlerini kullanmayın. Gerçek gateway refresh token'ı doğrulamalı,
rotate etmeli ve yeni token çiftini aynı `{ accessToken, refreshToken }` kontratıyla dönmelidir.

Yeni kişisel API'lerde `private, no-store`, `guardPublicApi`, request deadline signal'ı ve runtime
payload doğrulaması zorunludur. Auth token'larını log, island props, HTML veya cache key içine koymayın.

Birden fazla island ortak auth UI'ı kullanacaksa `@originloom/shared/lib/stores/user-info-store`
üzerinden state paylaşın. Server otoritesi olan profil cevabı bu store'u güncellemeli; cookie yalnızca
erken bir UI ipucudur, yetkilendirme kararı değildir.
