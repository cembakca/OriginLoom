# Sağlayıcıya yönlendirme

Ziyaretçiyi bankaya/sağlayıcıya göndermek bir **yazma işlemidir**. Bir şey kaydeder, cookie yazar ve
bir crawler link takip ettiği ya da tarayıcı sayfayı prefetch ettiği için gerçekleşmemelidir.

Bu yüzden `<a href>` değil, form:

```tsx
<form method="post" action="/api/referrals">
  <input type="hidden" name="slug" value={item.slug} />
  <button type="submit">{item.provider} ile devam et</button>
</form>
```

`server/api/referrals.ts` bunu karşılar ve **303** döner. 303 çünkü tarayıcı yenilemede POST'u
tekrarlamaz — aksi halde her F5 ikinci bir yönlendirme kaydeder.

## Korumalar

| Ne                                                | Neden                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `requireSameOriginMutation`                       | Başka bir siteden gönderilen form, tarayıcıda CSRF'in göründüğü şeydir |
| Rate limit (global + IP)                          | Yönlendirme kaydı upstream'e yazar; tek bir çağıran bütçeyi yiyemez    |
| `isBoundedRouteSlug(slug)`                        | Şekli bozuk bir slug gateway'e hiç sorulmaz                            |
| `normalizeNavigationUrl(..., { external: true })` | **Open redirect'i engelleyen satır budur**                             |
| `cache-control: private, no-store`                | Cevap kişiye özeldir ve hiçbir ara katmanda durmamalı                  |

Son maddeyi vurgulamak gerekir: dönen `redirectUrl` **güvenilmeyen girdidir**. Sağlayıcı bir gün
`javascript:` ya da başka bir origin gönderirse, bunu doğrulamadan `Location`'a koymak sizin
alan adınızın itibarıyla açık bir yönlendirici işletmek demektir. `external: true` cross-origin bir
hedefe izin verir ama yine de yalnız mutlak `https` URL'lerini kabul eder.

## Anonim oturum

Aynı ziyaretçiyi ziyaretler arasında tanımak için HttpOnly bir cookie'de rastgele bir id tutulur:

- **HttpOnly** — id sunucuya kimliği tanıtır, başka hiçbir şeye. Script okuyabilseydi sızacak bir şey
  daha olurdu.
- **SameSite=Lax**, Strict değil — ziyaretçi sağlayıcıdan cross-site bir gezinmeyle geri döner ve
  oturumun bunu atlatması gerekir.
- Bu bir **login değildir**. Kimlik doğrulamaz, kişisel veri taşımaz; yalnızca "bu tıklamalar aynı
  kişiden" der.

Tekrar tıklamalar sayılır, arkasındaki ziyaretçi tek ziyaretçi kalır.

## Ölçüm

Yönlendirme sayıları operasyonel veridir, sayfa verisi değil. Sayaç ucunu operations portuna koyun
(bkz. [cache-purge.md](./cache-purge.md) — aynı gerekçe: siteye açılmaması gereken uçlar).
