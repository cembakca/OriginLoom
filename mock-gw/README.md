# ssr-kit mock gateway

Bağımsız, dependency içermeyen Node.js geliştirme gateway'idir. Varsayılan olarak `4002`
portunda çalışır:

```bash
npm run mock-gw
```

Redis Docker'da kalırken gateway ve uygulamayı watch modunda birlikte çalıştırmak için proje
kökünde `npm run dev:local` kullanılabilir.

Uygulama runtime'ı fixture veya mock fallback içermez. Local geliştirme ve Docker Compose
`GATEWAY_URL` üzerinden bu servise bağlanır; gerçek gateway geldiğinde URL değiştirmek yeterlidir.

| Method | Endpoint                    | Amaç                         |
| ------ | --------------------------- | ---------------------------- |
| GET    | `/healthz`                  | Liveness                     |
| POST   | `/auth/login`               | Test access/refresh üretir   |
| POST   | `/auth/refresh`             | Refresh token rotation       |
| GET    | `/user/profile`             | Bearer token profil doğrular |
| GET    | `/account/summary`          | Korumalı hesap özeti         |
| GET    | `/pages/menuitem/list`      | Header/footer menüsü         |
| GET    | `/pages/retirement-banking` | Sayfa + SEO içeriği          |
| GET    | `/cms/redirects?path=...`   | Redirect/gone kuralı         |
| GET    | `/offers?...`               | Kredi teklifleri             |
| GET    | `/blogs?...`                | Sayfalı/sıralı blog listesi  |
| POST   | `/analytics/bot`            | Bot event sink               |

Bu servis gerçek bir IAM veya içerik gateway'i değildir; yalnızca uygulamanın HTTP
sözleşmelerini uçtan uca çalıştırmak için deterministik cevaplar verir.
