# Webhook alıcısı

`server/api/webhooks.ts`, sağlayıcının bu uygulamaya yazdığı uçtur: başvuru sonucu, ödeme durumu,
statü değişikliği. İnternete açık ve **söyleneni yapan** bir uç olduğu için, "istek geldi" ile
"sağlayıcı gönderdi" arasındaki boşluğun tamamı burada kapatılır.

Dördü de ayrı ayrı zorunlu ve her biri eksik kaldığında gerçek bir olaydır:

| Kontrol                        | Eksik kalırsa                                              |
| ------------------------------ | ---------------------------------------------------------- |
| **İmza** (ham gövde üzerinden) | Herkes size veri yazar                                     |
| **Timestamp penceresi**        | Yakalanan bir istek bir yıl sonra tekrar oynatılır         |
| **Idempotency**                | Sağlayıcının retry'ı ikinci bir ödeme/başvuru/e-posta olur |
| **Sınırlı okuma**              | Kimliksiz bir uçta bellek tüketme düğmesi                  |

## İmza ham gövde üzerinden

```ts
const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
```

İki ayrıntı kritik:

- **`raw`**, `JSON.parse` edilip yeniden serialize edilmiş nesne değil. Yeniden serialize edilmiş
  gövdeyi doğrulamak, gönderen yerine **sizin JSON encoder'ınızı** doğrular; anahtar sırası veya
  sayı formatı değiştiği anda geçerli imzalar reddedilir, daha kötüsü tersi olur.
- **Timestamp imzaya dahil.** Yalnız gövde imzalansaydı, yakalanan bir teslimat taze bir
  timestamp'le yeniden gönderilebilirdi.

Karşılaştırma sabit zamanlıdır. `timingSafeEqual` uzunluk farkında hata fırlattığı ve erken dönmek
beklenen uzunluğu sızdırdığı için iki taraf da önce sabit genişliğe hash'lenir.

## Pencere imzadan önce kontrol edilir

Sıra kasıtlı: bayat bir replay seli, 64 KB üzerinde HMAC hesaplamak yerine bir çıkarma işlemine mal
olur.

## Idempotency

İşlenmiş teslimat id'leri **sınırlı** bir tabloda tutulur (`SEEN_MAX_ENTRIES`, süreli). Sınırsız bir
id kümesi, hızını gönderenin belirlediği yavaş bir bellek sızıntısıdır.

Bu tablo süreç içidir: birden fazla instance çalıştırıyorsanız gerçek idempotency'yi paylaşımlı bir
yerde (Redis, veritabanı unique index'i) tutun. Buradaki tablo aynı instance'a düşen retry'ları
karşılar ve doğru desenin şeklini gösterir.

## Hızlı cevap verin

Sağlayıcı bağlantıyı açık tutar ve timeout'ta yeniden dener. Uç **202** döner ve işi kuyruğa bırakır;
webhook handler'ının içinde yavaş iş yapmak, retry fırtınasının başlama şeklidir.

## Yapılandırma

`WEBHOOK_SECRET` tanımlı değilse uç **503** döner ve hiçbir teslimatı kabul etmez. Secret'sız bir
webhook, sisteminize yazmanın açık bir yoludur.

İmza şeması **sağlayıcınındır, bu uygulamanın değil.** Buradaki `x-signature` / `x-timestamp` +
`sha256(timestamp.body)` yaygın bir şemadır (Stripe benzeri); kopyalamadan önce sağlayıcınızın
dokümanına bakın. Değişecek olan yalnız imzanın nasıl hesaplandığıdır — diğer üç kontrol aynı kalır.
