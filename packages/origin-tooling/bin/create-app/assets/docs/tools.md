# Araç sayfaları: hesaplayıcılar, karşılaştırıcılar

`/calculator` bir araç sayfasının şablonudur. Üç parçası var ve üçünün **tek** bir sorgu kontratını
paylaşması esastır (`src/lib/calculator-query.ts`):

1. **Route** — ilk sonucu sunucuda üretir
2. **Island** — aynı public API'yi çağırarak yerinde günceller
3. **Cache key** — hangi girdilerin farklı bir sayfa demek olduğuna karar verir

## İlk sonuç neden sunucuda?

Sadece hydration sonrası sayı üreten bir hesaplayıcı:

- crawler için boş bir kutudur,
- script yüklenmeyen ziyaretçi için hiç çalışmaz,
- paylaşılan bir URL'de farklı bir şey gösterir,
- ilk boyamada layout kayması yaratır.

SSR ilk sonucu island'a `initial` prop'u olarak geçer: loading state yok, kayma yok.

## Aritmetik neden tarayıcıda değil?

Hesap gateway'de yapılır. Faiz formülünün frontend'de bir kopyası, insanların karar verdiği bir sayı
için ikinci bir doğruluk kaynağıdır — ve iki kopya, iş tarafı bir yuvarlama kuralını değiştirdiği ilk
gün ayrışır. Island `fetch("/api/calculator?...")` çağırır; endpoint sayfanın kullandığı servisin
aynısını kullanır.

## Girdiler cache'i patlatmasın

Normalizer'lar değeri **reddetmez, kısıtlar**: tutar 1.000'e yuvarlanır, oran 2 ondalığa,
vade sabit bir kümeye düşer. Ziyaretçi ne yazarsa yazsın bir sonuç alır, ama sonuç sonlu sayıda
adresten birine düşer — slider'ın bir sayfayı on bin cache girdisine çevirmesini engelleyen budur.

## JavaScript kapalıyken

Island'ın formu gerçek bir `method="get" action="/calculator"` formudur. Script yoksa submit sayfayı
yeniden yükler ve route aynı sonucu sunucuda üretir. Aynı sayfa, aynı sayı, iki yol.

## URL durumu takip eder

Island hesapladıktan sonra `history.replaceState` ile URL'i günceller. Sonuç paylaşılabilir kalır ve
geri tuşu önceki plana döner — sayfadan çıkmaz.
