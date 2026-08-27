# Redis'te kimlik ve namespace'ler

Ortak bir Redis cluster'ında birden fazla OriginLoom ürünü çalışabilir. Bu belge, hangi verinin
neyle ayrıldığını ve **neden** öyle ayrıldığını anlatır.

Runtime state için iki, browser asset path'leri için ayrı bir sabit kimlik kullanılır:

| Değişken          | Ne zaman değişir  | Neyi ayırır                                         |
| ----------------- | ----------------- | --------------------------------------------------- |
| `RELEASE_ID`      | **her deploy'da** | Cache: render edilmiş HTML, fragment, resource      |
| `APP_ID`          | **hiçbir zaman**  | Koordinasyon: idempotency, auth refresh, rate limit |
| `ASSET_NAMESPACE` | **hiçbir zaman**  | URL: `<namespace>-icons/*`, `<namespace>/assets/*`  |

Üçü de production'da zorunlu. Eksikse ya da `APP_ID` platform varsayılanı (`origin-loom`) olarak
kalmışsa uygulama **boot etmeyi reddeder**.

---

## Neden iki tane

Bunlar birbirine benziyor ama **zıt yönlere çekiyor.**

**Cache bir deploy'u aşmamalı.** Yeni release farklı HTML üretir; eski release'in çıktısını okursa
ziyaretçiye bir sürüm önceki sayfayı verir. O yüzden cache anahtarları `RELEASE_ID` taşıyor ve yeni
deploy temiz bir namespace'e başlıyor.

**Koordinasyon bir deploy'u aşmak zorunda.** Rolling deploy sırasında eski ve yeni pod'lar aynı anda
ayakta. "Bu form bir kez işlensin" diyen kilit tam olarak **o iki tarafın anlaşması** demek. Her
release kendi namespace'ine bakarsa ikisi de "ben ilkim" der ve iş iki kez çalışır.

Yani tek bir kimlik ikisini birden yapamaz. `RELEASE_ID` uzun süre ikisini birden yapmaya çalıştı ve
ikinci işi yanlış yaptı.

---

## Anahtar biçimleri

```
ssr:<RELEASE_ID>:page:/kasko:...              cache girdisi
ssr:<RELEASE_ID>:lock:cold-fill:...           cache kilidi (cold-fill, revalidation)
ssr:<RELEASE_ID>:tag:...                      tag indeksi

ssr:coordination:<APP_ID>:ephemeral:...       idempotency kaydı, auth refresh sonucu
ssr:coordination:<APP_ID>:lock:...            idempotency ve auth refresh kilidi
ssr:coordination:<APP_ID>:rate-limit:...      dağıtık rate limit sayacı
```

**Cache kilitleri bilerek release'in içinde.** Cold-fill ve revalidation kilidi, release'e ait bir
cache girdisini korur; iki release'i birbirine karşı dışlamasına gerek yok, çünkü zaten farklı
girdileri dolduruyorlar.

---

## `APP_ID` olmasaydı ne olurdu

Aynı Redis'i paylaşan `sigorta` ve `yatirim-web` düşünün. `APP_ID` yokken üç anahtar da çakışırdı:

**Idempotency — en kötüsü.** Anahtar `idempotency:<namespace>:<key>`. Namespace'i uygulama seçiyor,
ve iki ürün de bülten formu için `"newsletter"` demeye çok yatkın. Aynı anahtar geldiğinde bir ürün
**diğerinin kaydedilmiş sonucunu replay eder**: kullanıcı sigorta'da form gönderir, yatırım'ın
cevabını alır.

**Rate limit.** Anahtar `public:<policy>:ip:<ip>`. İki üründe de aynı adlı public API varsa ve aynı
ziyaretçi ikisini de geziyorsa tek sayaca yazarlar. Sigorta'da gezinen kullanıcı yatırım sitesinde
limite takılır, ve etkin tavan yarıya iner.

**Auth refresh.** Anahtar refresh token'ın hash'i. Aynı gateway ve aynı kullanıcıda iki ürün aynı
kilidi paylaşır. Bu bazen _istenen_ davranış bile olabilir — ama kimse tasarlamadı. Kazara doğru olan
şey, koşullar değişince kazara yanlış olur.

---

## Bu nasıl oluştu (ve dokümanın eski hâlinin neden yanıltıcı olduğu)

`APP_ID` gelmeden önce koordinasyon anahtarları da `ssr:<RELEASE_ID>:` altındaydı. Bu, ürünleri
**kazara** ayırıyordu: her uygulama kendi `RELEASE_ID`'sini kullandığı için anahtarları da
çakışmıyordu. Bazı belgeler bu yüzden "ürün izolasyonu `RELEASE_ID` ile yapılır" diyordu.

Ama aynı namespace deploy'ları da ayırdığı için asıl işi bozuyordu — idempotency rolling deploy
boyunca "en fazla bir kez" diyemiyordu. Koordinasyonu release namespace'inden çıkarmak o hatayı
düzeltti ve **kazayı da beraberinde götürdü**. `APP_ID`, kaybolan yarıyı bu sefer kasıtlı olarak
geri koyuyor.

Sonuç olarak `RELEASE_ID` bir **ürün kimliği değildir**. `sigorta-4821` gibi bir değer iki kimliği
birbirine yapıştırır; koordinasyonun ihtiyacı olan yalnızca `sigorta` yarısıdır ve o yarı ayrı bir
değişken olarak verilmelidir.

---

## Değer seçme

- `APP_ID`: ürünün kısa, sabit adı — `sigorta`, `yatirim-web`. `[A-Za-z0-9._-]`, en fazla 64
  karakter. **Ortam adı koymayın**: `sigorta-prod` ile `sigorta-staging` ayrı Redis'e ya da ayrı
  DB index'ine gitmeli, aynı cluster'da isimle ayrılmamalı.
- `RELEASE_ID`: build/deploy kimliği — CI'ın verdiği commit sha'sı ya da build numarası. Aynı
  release'in **bütün** pod'ları aynı değeri kullanmalı.
- `ASSET_NAMESPACE`: CDN ve origin üzerindeki sabit, küçük harfli URL slug'ı — örneğin `revolt`.
  `APP_ID`'den türetilmez; uygulama yeniden adlandırılsa bile mevcut CDN anahtarları değişmez.

`APP_ID` değiştirmek, o uygulamanın bütün koordinasyon durumunu terk etmek demektir: uçuştaki
idempotency kayıtları ve rate limit pencereleri görünmez olur. Kısa TTL'li oldukları için kendi
kendine geçer, ama bunu **bilerek** yapın — rutin bir isim değişikliği değildir.

---

## Kendi driver'ınızı yazıyorsanız

`registerCacheDriver()` ile gelen bir store'un anahtar biçimini platform belirlemiyor. İki şey size
ait:

1. **Aynı ayrımı kurun.** Cache release'e, koordinasyon uygulamaya göre bölünmeli. `config.appId` ve
   `config.releaseId` `@originloom/core/config` üzerinden okunabilir.
2. **`coordinationScope` beyan edin.** Store'unuz pod'lar arasında paylaşılmıyorsa `"process"` (ve bu
   varsayılan). `"shared"` demek, "başka bir pod'un aldığı kilidi bu pod görür" demektir; tek-flight
   kilitleri ve idempotency garantisi bu cevaba dayanıyor.

---

## Doğrulama

```bash
redis-cli --scan --pattern 'ssr:coordination:*' | head
```

Çıkan her anahtarın üçüncü segmenti bu uygulamanın `APP_ID`'si olmalı. Başka bir ürünün adını
görüyorsanız iki uygulama aynı namespace'i paylaşıyordur.

Cache tarafı için:

```bash
redis-cli --scan --pattern 'ssr:*' | grep -v ':coordination:' | head
```

İkinci segment `RELEASE_ID` olmalı; birden fazla release görüyorsanız eski deploy'un anahtarları
henüz TTL'lerini doldurmamış demektir, bu normaldir.
