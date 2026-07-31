# `validateParams`: param'ın şekli mi, varlığı mı?

İki farklı soru var ve ikisine de cevap gerekir.

## Şekil — offline, ücretsiz

```ts
validateParams: (ctx) => isBoundedRouteSlug(ctx.params.slug),
```

`server/routes/item-detail.tsx` böyle yapar. 4 KB'lık bir param, `../../etc/passwd`, kontrol
karakteri — hiçbiri cache'e, gateway'e, render'a ulaşmaz. Bu kontrol bir ağ çağrısı yapmaz, bu yüzden
çöp param seli bir upstream seline dönüşemez.

Ama `/items/var-olmayan-sey` bu kontrolü **geçer**. Şekli doğrudur.

## Varlık — cevabı bu kod tabanında olmayan soru

`server/routes/catalog-category.tsx` ikinci soruyu sorar:

```ts
validateParams: (ctx) => isKnownCategory(ctx.params.category, ctx.request),
```

`server/services/route-domains.ts` geçerli değerlerin listesini gateway'den alır. Bu liste deploy ile
değil, katalog değiştiğinde değişir — yani kod tabanına yazılamaz.

Sırayla çalışır: **önce şekil, sonra upstream.** Şekli bozuk bir param gateway'e hiç sorulmaz.

## Neden snapshot cache'lenir

`validateParams` **page cache'ten önce** çalışır. Yani cache hit olan isteklerde bile çalışır — o
route'a giden her isteğin yolundadır. Snapshot paylaşımlı cache'te tutulmasa, cache'i mükemmel çalışan
bir sayfa yine de istek başına bir gateway çağrısı öderdi.

TTL boyunca tüm fleet için tek çağrı. Bozuk bir snapshot onarılmaz, silinir ve yeniden çekilir.

## Ne zaman hangisi

| Durum                                             | Kontrol                          |
| ------------------------------------------------- | -------------------------------- |
| Slug/id formatı                                   | Şekil (`isBoundedRouteSlug`)     |
| Sabit, kod tabanında bilinen bir küme             | `Set` + şekil                    |
| CMS/katalog sahibi olduğu, deploysuz değişen küme | Gateway snapshot + şekil         |
| Kullanıcıya özel bir kaynak                       | Hiçbiri — loader'da `notFound()` |

Son satır önemli: `validateParams` **paylaşımlı** bir karardır. Sonucu kullanıcıya göre değişen bir
şeyi buraya koyarsanız, bir ziyaretçinin erişimi diğerinin cache'ini belirler.
