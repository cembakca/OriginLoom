# Secret rotasyonu ve cookie sertleştirme

## Rotasyon: tek secret neden yetmiyor

Tek bir secret rotasyonu yazı-tura yapar. Rolling deploy sırasında iki release iki farklı değer
tutuyor, ve birinin imzaladığı her şeyi diğeri reddediyor — bir editörün bir dakika önce açtığı
preview linki, render edilmiş bir sayfada duran island yer tutucusu. Reddetmek, doğrulayanın bildiği
şeye göre **doğru**; yine de rotasyonun sebep olduğu bir kesinti.

Sözleşme tek cümle: **current ile imzala, halkadaki herhangi bir anahtarla doğrula.**

| Secret                             | Rotasyon ikizi                              |
| ---------------------------------- | ------------------------------------------- |
| `PREVIEW_SECRET`                   | `PREVIEW_PREVIOUS_SECRET`                   |
| `SERVER_ISLAND_SECRET`             | `SERVER_ISLAND_PREVIOUS_SECRET`             |
| `AUTH_REFRESH_COORDINATION_SECRET` | `AUTH_REFRESH_COORDINATION_PREVIOUS_SECRET` |

### Nasıl döndürülür

1. Yeni değeri **her** pod'a `*_SECRET` olarak, eskisini `*_PREVIOUS_SECRET` olarak verin. Deploy edin.
2. Eski anahtarla imzalanmış her şeyin ömrü dolana kadar bekleyin (preview grant'i için
   `PREVIEW_TTL_MS`, island yer tutucusu için cache TTL'i).
3. `*_PREVIOUS_SECRET`'i kaldırın. Deploy edin. Eski anahtar artık reddediliyor — emekliye ayırmanın
   amacı buydu.

İkinci adımı atlarsanız rotasyon yine çalışır; yalnız o pencerede uçuşta olan artefaktlar reddedilir.

### `kid` nedir

İmza `<kid>.<digest>` biçiminde ve `kid` onu üreten anahtarın etiketi. Etiket **secret değil**;
secret'tan türetilmiş sekiz karakterlik bir HMAC. İki işe yarıyor: doğrulama halkadaki her anahtarı
denemek yerine tek HMAC yapıyor, ve tanınmayan bir `kid` hiç iş yapılmadan reddediliyor.

Etiketi operatörden istemiyoruz. Gece üçte secret döndüren birinin ayrıca bir etiket uydurup onu
değerle senkron tutması gerekmemeli, ve türetilmiş bir etiket adlandırdığı anahtarla çelişemez.

---

## `__Host-` cookie'leri

Oturum cookie'leri production'da `__Host-` önekiyle yazılıyor:

```
__Host-access_token   __Host-refresh_token   __Host-signed_in
__Host-account_text   __Host-referral_session
```

Önek dekorasyon değil. Onsuz, tarayıcının bu origin için tuttuğu bir cookie'yi kayıtlı alan adı
altındaki **herhangi bir host** yazmış olabilir — unutulmuş bir staging kutusu, başkasının işlettiği
bir subdomain, kardeş bir uygulamadaki XSS — ve `Domain=` onu buraya görünür kılar. Önek, tarayıcının
tersini garanti etmesi: bu cookie tam olarak bu origin tarafından, HTTPS üzerinden, tüm path için ve
`Domain` genişletmesi olmadan yazıldı.

**Her cookie değil.** `__Host-` `Domain`'i yasakladığı için, bir ürünün gerçekten subdomain'ler
arasında paylaşmak istediği pazarlama/atıf cookie'si onu taşıyamaz. Sıkı görünmek için o paylaşımı
sessizce bozmak daha kötü bir takas olurdu.

**Development'ta önek yok.** Önek `Secure` gerektiriyor ve development secure değil; orada önekli bir
cookie tarayıcı tarafından tek kelime etmeden düşürülürdü — hem güvenlik yok hem oturum yok.

### Geçiş

Rollout'un bir ortası var: ziyaretçiler eski öneksiz cookie'yi ömrü boyunca taşımaya devam ederken
her yeni yanıt önekli olanı yazıyor. Platform ikisini de okuyor, **önekli olan önce**. Yalnız yeniyi
okumak deploy günü herkesi çıkış yaptırırdı; yalnız eskiyi okumak geçişi hiç bitirmezdi.

Çıkış (`jar.delete`) **iki adı birden** süresiz kılıyor. Yalnız önekliyi temizlemek, rollout'tan önce
giriş yapmış bir ziyaretçinin gerçek refresh token'ını tarayıcısında bırakırdı — ve temizlemeyi
ıskalayan bir çıkış hiçbir yerde hata gibi görünmez.

Öneksiz cookie'ler her yerde süresi dolduğunda `cookieNameCandidates`'in ikinci girdisi hiçbir şeyle
eşleşmez olur ve kaldırılabilir.

### `SameSite` bilerek `lax` kaldı

`strict` daha sıkı, ve bu uygulamalar için doğru olduğu **gösterilmedi**: e-postadaki bir linkten
gelen ziyaretçi çıkış yapmış olarak karşılanır. Bu bir ürün kararı ve ölçülmeden verilmemeli.
Yazılı olması, unutulmuş olmasından farklı — ölçüp `strict`'e geçmek istediğinizde `jar.set`'e
`sameSite: "strict"` vermek yeterli.
