# Mutation (form ve yazma uçları)

İki yol var ve seçim tek soruya bakar: **bu ucu tarayıcı dışında biri de çağıracak mı?**

|                   | `Route.action`                                            | `POST /api/...`                            |
| ----------------- | --------------------------------------------------------- | ------------------------------------------ |
| Formun `action`'ı | sayfanın kendisi                                          | ayrı bir URL                               |
| Hatada            | sayfa 4xx ile yeniden çizilir, **girilen değerler durur** | redirect + query string, değerler kaybolur |
| Makine istemcisi  | yok                                                       | var                                        |
| Cache             | POST'ta otomatik `no-store`                               | ucun kendisi zaten cache'siz               |

Sayfaya ait bir form — abonelik, iletişim, filtre kaydetme — `Route.action` ister. Aynı yazmayı bir
mobil uygulama da çağıracaksa `/api` ucu yazın; ikisini birden istiyorsanız `action` içinden aynı
servisi çağırın, mantığı kopyalamayın.

Çalışan örnek (API ucu): `/contact` sayfasındaki form → `POST /api/enquiries` →
`server/api/enquiries.ts` → `server/services/enquiries.ts` → gateway.

## `Route.action` — sayfanın kendi formu

```ts
export default defineRoute<PageData, FormState>({
  path: "/bulten",
  cache: pageCache(PageCacheId.newsletter), // GET paylaşımlı; POST değil

  action: async (ctx) => {
    const fields = await readFormFields(ctx.request, { maxFields: 8, maxValueLength: 320 });
    const values = { email: formValue(fields, "eposta"), onay: formChecked(fields, "onay") };

    const errors = validate(values);
    // 422, 200 değil: sayfa geri gelir ama gönderim başarısızdır ve tarayıcı
    // olmayan her istemci bunu bilmeyi hak eder.
    if (Object.keys(errors).length > 0) return { data: { values, errors }, status: 422 };

    await subscribe(ctx.request, values.email);
    // Post/Redirect/Get: yenileme ve geri tuşu GET çalıştırır, tarayıcı bir daha
    // "formu tekrar göndereyim mi?" diye sormaz.
    return redirect("/bulten?durum=ok", 303);
  },

  loader: async (ctx) => ({
    data: { state: ctx.action ?? EMPTY_STATE, ok: ctx.url.searchParams.get("durum") === "ok" },
  }),

  Component: ({ data }) => <NewsletterForm {...data} />,
});
```

Action'ın iki çıkışı vardır ve ikisi de web'in zaten sahip olduğu şeylerdir:

- **`redirect(location, 303)`** — başarı yolu.
- **`{ data, status }`** — red yolu. Sonuç loader'a `ctx.action` olarak ulaşır, yani **boş formu
  çizen component** aynı formu hatalarıyla ve ziyaretçinin kendi değerleriyle yeniden çizer. Kayıp
  yok, ikinci bir "sonuç sayfası" yok.

### Platformun sizin adınıza garanti ettiği üç şey

1. **Gönderim asla cache'lenmez.** Güvenli olmayan her metot için policy, key oluşabilmeden önce
   düşürülür — bu aynı zamanda yanıtı `private, no-store` yapan şeydir. Rota bunu ayarlamaz;
   ayarlasaydı forma kavuşan ilk sayfa bir gün unutur ve bir ziyaretçinin doğrulama hataları
   sonraki bine servis edilirdi.
2. **`action` tanımlamayan sayfa 405 döner.** Sessizce sayfayı render edip gönderene "yazma başarılı"
   izlenimi vermez.
3. **Cross-origin gönderim 403.** Her mutation'a uygulanan aynı origin kontrolü — aşağıdaki
   `requireSameOriginMutation` bölümü bunun neden token'ın yerine geçtiğini anlatır.

### Gövdeyi okumak

`readFormFields` gönderimi düz string alanlara çevirir ve üçünü de sınırlar: alan sayısı, alan
uzunluğu ve dosya parçaları (atılır). **Kırpmaz, reddeder** — kırpılmış bir değer ziyaretçinin
yazmadığı bir değerdir ve onu sessizce kaydetmek, "çok uzun" demekten kötüdür.

`formValue` trim'lenmiş değeri döndürür, hiç `undefined` dönmez. `formChecked` kutunun işaretli olup
olmadığını **varlığa** bakarak söyler; işaretsiz bir checkbox hiçbir şey göndermez.

### Erişilebilirlik

Örnekteki markup'ın tamamı tarayıcının zaten bildiği şeylerdir: `method`, `action`, isimli input'lar,
gerçek `<label for>`. Geçersiz alan `aria-invalid` taşır ve mesajını `aria-describedby` ile
gösterir; hata özeti `role="alert"`'tür ve reddedilen sayfa yüklendiği anda okuyucuya duyurulur —
çünkü sayfa gerçekten yüklenir. Fetch-and-swap bir çözümün bu duyuruyu ayrıca üretmesi gerekir.

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

Form düz `method="post"`; `action` ya sayfanın kendisidir (`Route.action`) ya da bir uçtur
(`/api/enquiries`). Hydration'dan önce, hydration olmadan ve bundle yüklenemediğinde de çalışır.
`e2e/ssr.no-js.spec.ts` bunu JavaScript kapalı bir tarayıcıda doğrular.

İleride client-side gönderim eklerseniz aynı endpoint'i `fetch` ile çağırın ve formu kaldırmayın:
progressive enhancement, formun yerine geçen değil üstüne binen bir katmandır.

## Yeni bir yazma ucu eklerken

Sayfaya ait bir formsa: rotaya `action` ekleyin, `readFormFields` ile okuyun, hatada `status` ile
`data` döndürün, başarıda `redirect(..., 303)`. Ayrı bir uç gerekmiyorsa yazmayın.

Makine istemcisi de olacaksa:

1. `server/api/<ad>.ts` — kendi `PublicApiPolicy`'si ve `guardPublicApi` ilk satırda.
2. Girdiyi alan alan doğrulayın; sınırsız uzunlukta hiçbir şeyi kabul etmeyin.
3. Upstream çağrısını `server/services/<ad>.ts` içine koyun, `GatewayContracts` ile bütçeleyin.
4. Tarayıcı formuysa `303` ile PRG; makine istemcisiyse JSON + uygun status.
5. `server/api/index.ts` içinde mount edin.
6. `tests/<ad>-api.test.ts` — en az: cross-site red, geçersiz girdi, mutlu yol, rate limit.
7. `pnpm ci`.
