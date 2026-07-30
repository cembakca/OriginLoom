# Mutation (form ve yazma uçları)

Çalışan örnek: `/contact` sayfasındaki form → `POST /api/enquiries` → `server/api/enquiries.ts` →
`server/services/enquiries.ts` → gateway. Yeni bir yazma ucu eklerken bu dosyaları örnek alın.

## Public bir yazma ucunun taşıması gereken üç şey

```ts
const ENQUIRY_POLICY: PublicApiPolicy = {
  name: "enquiry",
  windowMs: 60_000,
  globalLimit: 120, // süreci korur
  ipLimit: 5, // tek bir çağıranın bütçeyi yemesini engeller
  requireSameOriginMutation: true, // CSRF savunması
};

const denied = await guardPublicApi(request, c.get("clientIp") ?? "unresolved", ENQUIRY_POLICY);
if (denied) return denied;
```

1. **`guardPublicApi`** — her public uçta, ilk satırda. Guard reddederse hazır `403`/`429`
   response'u döner; siz sadece geri verirsiniz.
2. **Doğrulama** — gövde untrusted input'tur. Alan alan okuyun, uzunluk sınırı koyun, şekil
   kontrolü yapın; doğrulanmamış hiçbir alan aşağı geçmesin.
3. **Redirect (PRG)** — tarayıcıdan gelen form POST'una gövde değil `303` dönün. Kullanıcı GET
   üzerinde kalır; yenilemek formu tekrar göndermez, sonuç paylaşılabilir bir URL olur.

## `requireSameOriginMutation` neden token'ın yerine geçiyor?

Guard, Fetch Metadata (`Sec-Fetch-Site`) okur; yoksa `Origin`, o da yoksa `Referer` başlığına düşer
ve `SITE_URL` ile karşılaştırır. Bunların üçünü de saldırganın sayfası taklit edemez — tarayıcı
gönderir. Bu yüzden formda gizli bir CSRF token'ı yoktur; olsaydı ayrıca saklanması, döndürülmesi ve
cache'lenmemesi gereken bir durum daha olurdu.

**Geliştirmede 403 alıyorsanız** ilk bakılacak yer burasıdır: guard, `Origin` başlığını `SITE_URL`
ile karşılaştırır ve eşleşmezse fallback'e düşmez. `.env.development` `SITE_URL=http://127.0.0.1:3010`
yazar; siteyi `http://localhost:3010` üzerinden açarsanız origin farklı olur ve form reddedilir.
İkisinden birini seçip tutarlı kullanın.

Sınırı bilin: bu koruma **tarayıcı** kaynaklı isteklere göredir. Sunucu-sunucu bir çağrının
`Origin`'i yoktur; makine çağıranlar için imzalı token/mTLS gibi ayrı bir kimlik gerekir.

## Cache

Yazma sonucunu gösteren sayfa `strategy: "never"` olmalıdır (`src/lib/cache-keys.ts` içinde
`contact` kaydı). Bir ziyaretçinin "Mesajınız alındı" HTML'i diğerine servis edilemez.

Guard'ın döndüğü ve endpoint'in yazdığı her response `private, no-store` taşır.

## Sonucu sayfaya taşırken

Query string'den gelen değeri doğrudan render etmeyin. `server/routes/contact.tsx` önce bir
allowlist'ten geçirir:

```ts
const STATUSES = ["sent", "invalid", "failed"] as const;
const status = STATUSES.find((candidate) => candidate === ctx.url.searchParams.get("status"));
```

Sayfaya yankılanan bir değer, çağıranın seçtiği bir değerdir.

## JavaScript olmadan çalışır

Form düz `method="post" action="/api/enquiries"`. Hydration'dan önce, hydration olmadan ve bundle
yüklenemediğinde de çalışır. `e2e/ssr.no-js.spec.ts` bunu JavaScript kapalı bir tarayıcıda doğrular.

İleride client-side gönderim eklerseniz aynı endpoint'i `fetch` ile çağırın ve formu kaldırmayın:
progressive enhancement, formun yerine geçen değil üstüne binen bir katmandır.

## Yeni bir yazma ucu eklerken

1. `server/api/<ad>.ts` — kendi `PublicApiPolicy`'si ve `guardPublicApi` ilk satırda.
2. Girdiyi alan alan doğrulayın; sınırsız uzunlukta hiçbir şeyi kabul etmeyin.
3. Upstream çağrısını `server/services/<ad>.ts` içine koyun, `GatewayContracts` ile bütçeleyin.
4. Tarayıcı formuysa `303` ile PRG; makine istemcisiyse JSON + uygun status.
5. `server/api/index.ts` içinde mount edin.
6. `tests/<ad>-api.test.ts` — en az: cross-site red, geçersiz girdi, mutlu yol, rate limit.
7. `pnpm ci`.
