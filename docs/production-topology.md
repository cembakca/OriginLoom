# Production topolojisi kapısı

`pnpm topology` (CI'da `topology` işi) tek bir sorunun cevabını arar: **bu platform bir pod'da değil,
gerçek şekliyle çalışıyor mu?**

```bash
REDIS_URL=redis://127.0.0.1:6379 pnpm topology
```

## Neden ayrı bir kapı

CI'daki container smoke'u değerlidir ama neyi kanıtladığı sık karıştırılıyor. `REDIS_URL`'i hiçbir
şeyin dinlemediği bir porta veriyor ve `CACHE_REQUIRED=false` kullanıyor — yani kanıtladığı şey
**imajın Redis'siz de ayağa kalkıp servis ettiği**. Bu bilinmeye değer ve production'ın yaptığı şey
değil.

Bu platformun sattığı garantilerin hiçbiri tek süreçten görünmüyor:

- Paylaşılan bir HTML cache, ancak **ikinci** bir pod ilkinin yazdığını okursa paylaşılmıştır.
- "Anahtar başına en fazla bir kez" iki pod hakkında bir iddiadır, bir pod hakkında değil.
- Pod başına sıfırlanan bir rate limit, rate limit değildir.
- Release/app namespace ayrımının tamamı **rolling deploy anına** dairdir: aynı uygulamanın iki
  release'i aynı anda ayakta.

## Ne kuruyor

Bir gerçek Redis, bir mock gateway, **üç** uygulama süreci:

```
pod-a ─┐                        RELEASE_ID = release-n            island secret: OLD
pod-b ─┼─ aynı APP_ID ──→ Redis
pod-c ─┤                        RELEASE_ID = release-n-plus-1     island secret: NEW + OLD
pod-d ─┘                        RELEASE_ID = release-n-plus-1     island secret: NEW  (rotasyon bitti)
```

Üçü de `CACHE_BACKEND=redis` ve **`CACHE_REQUIRED=true`** ile koşuyor.

## Ne doğruluyor

| Kontrol                                                     | Ne kanıtlıyor                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| İki pod da hazır oluyor                                     | `CACHE_REQUIRED=true` altında hazır olmak Redis'in gerçekten cevap verdiği demek                        |
| İkinci pod, ilkinin cache'lediğini servis ediyor            | L2 girdisi gerçekten paylaşılıyor (`x-cache: HIT`)                                                      |
| Bir idempotency anahtarı işi bir kez çalıştırıyor           | `runOnce` pod'lar arasında koordine oluyor — gateway iki gönderim için **bir** upstream çağrısı görüyor |
| Yeni release, eskisinin HTML'ini servis etmiyor             | Cache `RELEASE_ID` ile ayrılmış                                                                         |
| Yeni release, eskisinin idempotency kaydına saygı duyuyor   | Koordinasyon `APP_ID` ile ayrılmış ve deploy sınırını **aşıyor**                                        |
| Rotasyon öncesi imzalanmış island yer tutucusu hâlâ doluyor | Anahtar halkası: current imzalıyor, previous doğrulamaya devam ediyor                                   |
| Rotasyon bitince aynı yer tutucu reddediliyor               | Emekliye ayrılan anahtar gerçekten emekli — adlandırmanın amacı buydu                                   |

Dört ve beşinci satır birlikte okunmalı: aynı anda hem ayrılması hem aşması gereken iki farklı veri var ve
bunu ancak bir rollout gösterebilir. `docs/migrations/0.7.64.md` ve üretilen `docs/namespaces.md` bu
ayrımın gerekçesini anlatıyor; burası onun **çalıştığını** gösteren yer.

Son iki satır aynı şeyi secret rotasyonu için yapıyor. Bir island yer tutucusu bir kez imzalanıp
cache'li HTML'in içinde oturuyor — isteği de, deploy'u da aşıyor. Rolling deploy sırasında onu
imzalayan pod ile doldurması istenen pod farklı release'ler ve farklı secret'lar tutuyor; tek
secret'lı bir kurulumda render edilmiş her sayfadaki her delik rollout boyunca boş dönerdi. Bunu
hiçbir birim testi gösteremez.

## İşin sayması nasıl mümkün oluyor

Gateway fixture'ı `POST /newsletter/subscribers` çağrılarını sayıyor ve `GET /__fixture/counters`
ile veriyor. Tek süreç, birden fazla pod — yani "iş kaç kez çalıştı" sorusunu yalnız o cevaplayabilir.
`runOnce`'ın verdiği söz dışarıdan **sadece** burada görünür.

## Kontrollerin kendisi doğrulandı

Yazılırken hepsi en az bir kez düştü, ve kritik olanlar kasıtlı olarak da kırıldı: pod-c'ye farklı
bir `APP_ID` verildiğinde gateway bir yerine **iki** abonelik çağrısı görüyor; pod-c'den
`SERVER_ISLAND_PREVIOUS_SECRET` çekildiğinde rotasyon kontrolü 400 alıp düşüyor. Bir
kapının değeri geçmesinde değil, geçmediğinde ne yakaladığındadır.

## Henüz kapsamadıkları

Dürüst olmak gerekirse bu kapı review'ın istediği listenin tamamı değil:

- **Graceful shutdown / drain** — SIGTERM sonrası uçuştaki isteğin tamamlanması ve `/readyz`'in önce
  düşmesi doğrulanmıyor.
- **Rate limit** — pod'lar arası paylaşıldığı burada değil, `redis.test.ts`'te birim seviyesinde
  pinli.

Bunlar eksik olarak duruyor; "kapı yeşil" onları kapsadığı anlamına gelmez.

## SAST durumu

`codeql.yml` içindeki `status` işi her koşuda bu deponun gerçekten taranıp taranmadığını run
özetine yazıyor. Private bir depoda CodeQL sonuçları yüklemek GitHub Advanced Security gerektiriyor,
o yüzden analiz atlanıyor — ve atlanan bir iş "burada görülecek bir şey yok" gibi okunduğu için
durum artık açıkça yazılıyor: **şu an SAST kapsamımız yok.**
