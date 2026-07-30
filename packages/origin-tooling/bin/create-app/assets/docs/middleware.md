# Middleware

Next.js'teki `middleware.ts` karşılığı: bir document isteğine, route eşleşmeden önce uygulanan
uygulamaya özel kurallar. Örnekleri `server/middleware/` altındadır ve liste
`server/middleware/index.ts` içinde `createApp({ middleware })`'e verilir.

## Sıra

```
before-auth middleware → auth → session/tracking → CMS redirect → before-render middleware → routing rules → SSR
```

Platformun kendi adımları (auth, session, CMS redirect) bu listede değildir; sırası değişmez. Bir
middleware yalnızca hangi tarafta duracağını söyler:

| Phase                        | Ne zaman                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| `before-auth`                | Bakım modu, tenant çözümleme, ülke bazlı kapatma — token/cookie yazılmadan |
| `before-render` (varsayılan) | Locale, deney kovası, feature flag, response header — `trackingId` hazır   |

Aynı phase içinde sıra, dizideki sıradır.

## Tanım

```ts
import { defineMiddleware } from "@originloom/core/middleware";

export const localeMiddleware = defineMiddleware({
  name: "locale", // kebab-case, trace'lerde görünür
  matcher: ["/urunler/:slug"], // opsiyonel; yoksa tüm document istekleri
  exclude: ["/api/:path*"], // opsiyonel; matcher'dan önce bakılır ve kazanır
  handler: (ctx) => {
    const locale = ctx.cookie("locale") ?? "tr";
    return {
      requestHeaders: { "x-locale": locale },
      values: { locale },
    };
  },
});
```

`ctx` içinde: `request`, `url` (rewrite öncesi browser URL'i), `publicPath`, `params` (matcher'dan),
`clientIp`, `requestId`, `trackingId`, `values`, `cookie(name)`, `header(name)`.

(Yalnız `Accept-Language`'a bakan bir locale için middleware'e gerek yok:
`locale(ctx.request)` zaten `src/lib/cache-keys.ts` içindeki key'lerde kullanılıyor. Yukarıdaki
örnek, locale kararı cookie/path/tenant gibi başka bir yerden geldiğinde geçerlidir.)

Dönen nesnedeki alanlar:

| Alan              | Etki                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `response`        | Terminal cevap; pipeline durur, route çalışmaz                                   |
| `redirect`        | `"/giris"` veya `{ location, status }` — `301/302/303/307/308`, varsayılan `307` |
| `requestHeaders`  | Loader'ların göreceği header; `null` siler                                       |
| `responseHeaders` | Bu isteğin ürettiği cevaba eklenir                                               |
| `cookies`         | `"deger"`, `{ value, maxAge, httpOnly, … }` veya `null` (siler)                  |
| `values`          | `ctx.values` olarak loader/cache resolver ve sonraki middleware'de               |
| `cacheVary`       | `values` içinden hangileri HTML cache'ini böler (varsayılan: hepsi)              |

Hiçbir şey yapmayacaksa `undefined` döndürün.

## Matcher

`matcher` bir allowlist'tir: verilmezse her document isteğinde çalışır. `exclude` ise önce bakılan ve
matcher'ı yenen bir denylist. Çapraz kesen kuralların gerçek şekli çoğunlukla "tüm sayfalar, ama şu
dal değil" olduğu için ikisi birlikte kullanılır:

```ts
matcher: ["/:path*"],      // her document
exclude: ["/api/:path*"],  // ama endpoint yüzeyi asla
```

Pattern söz dizimi `src/routing/rules.ts` ile aynı (`/urunler/:slug`, `/hesap/:path*`) ve
tarayıcıdaki yola (rewrite öncesi `publicPath`) uygulanır. Yakalanan parametreler `ctx.params`'ta.

Mount edilmiş `/api/*` route'ları zaten bu pipeline'a girmez; ama karşılığı olmayan bir
`/api/internal/*` yolu SSR fallback'ine düşer ve pipeline çalışır. Gateway'e istek atan bir
middleware'in orada boşa çalışmaması için `exclude` şart.

## Cache güvenliği

`values`'daki her değer **varsayılan olarak paylaşımlı HTML cache key'ini böler**. Sebebi tek
cümleyle: bir middleware sayfanın render'ını değiştiriyorsa, bir ziyaretçinin HTML'i diğerine
servis edilemez.

```ts
// Deney kovası HTML'i değiştirir → cache key'e girer (varsayılan davranış).
return { values: { variant } };

// Kampanya kodu yalnız analitik içindir, HTML'i değiştirmez → tek entry paylaşılır.
return { values: { campaign }, cacheVary: [] };
```

`cacheVary: []` yalnızca değerin sayfanın çıktısını **kesinlikle** etkilemediği durumda doğrudur.
Bir loader `ctx.values.campaign`'i render ediyorsa, ilk isteğin HTML'i herkese gider.

Kova sayısı cache'i böler: iki değerli bir deney, o sayfanın entry sayısını ikiye katlar. Sınırsız
değerli bir şeyi (kullanıcı id'si, arama terimi) `values`'a koymayın.

## Sınırlar

- Middleware **document istekleri** için çalışır. `server/api/*` altında mount edilen route'lar bu
  pipeline'a girmez; oralarda `server/api/index.ts` içinde Hono `app.use()` kullanın.
- `authorization`, `cookie`, `x-pathname`, `x-client-ip` request header'ları platformundur; bir
  middleware bunları yazamaz (yazmayı denerse istek 500 olur).
- `set-cookie` response header'ı yerine `cookies` alanını kullanın.
- Handler hata fırlatırsa istek 500 döner — fail-open değildir. Downstream bir servis kararsızsa,
  bunu handler içinde yakalayıp güvenli varsayılana düşün.
- Statik redirect/rewrite kuralları middleware'e değil `src/routing/rules.ts`'e aittir; CMS'ten gelen
  redirect'leri platform zaten çözer.

## Servise sorup yönlendirme

`server/middleware/redirect-rules.ts` çalışan örnektir: gelen URL'i gateway'in
`/routing/decide?url=...` ucuna sorar, cevap `{ action: "redirect", location, status }` ise
yönlendirir, `{ action: "next" }` ise hiçbir şey döndürmez ve istek normal akışına devam eder. Mock
gateway `/eski-katalog` ve `/kampanya` için kural döndürür, diğer her şey için `next` der.

Bu deseni kopyalarken dört şey kasıtlıdır:

- **`matcher` + `exclude`** — kural sayfalar hakkındadır; endpoint'ler bu turu ödemez.
- **TTL'li bounded cache** — aksi halde her sayfa görüntüleme render'dan önce bir gateway turu öder.
  Platformun kendi CMS redirect adımı da aynı sebeple cache'ler (`REDIRECT_CACHE_TTL_MS`).
- **Fail-open** — servis cevap veremezse sayfa yine render olur. Yalnız request deadline hatası
  yeniden fırlatılır; onu platform cevaplar.
- **Untrusted payload** — status kapalı kümeden seçilir, hedef same-site olmak zorundadır. Herhangi
  bir host'a yönlendirebilen bir kural servisi, güzel API'li bir open redirect'tir.

`{ action: "next" }` gibi açık bir "devam et" cevabı, 404'ü "kural yok" diye okumaktan iyidir:
servis 404 dönüyorsa bu "kural yok" mu, "endpoint yok" mu belli değildir.

## Test

Middleware bir fonksiyondur; context'i elle kurup doğrudan çağırın — örnek
`tests/middleware.test.ts` (gateway'e giden örnek için `@originloom/core/adapters/gateway` mock'lanır).
Uçtan uca davranış için `createApp({ middleware })` ile bir uygulama kurup `app.request(...)` çağırın.
