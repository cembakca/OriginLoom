# Cache ve SSR Performans Yol Haritası

Bu belge, OriginLoom altyapısı ile gerçek tüketici uygulama olan `sigorta` için cache ve SSR
performans çalışmalarını küçük, bağımsız ve doğrulanabilir fazlara ayırır.

İlk çalışma topolojisi **memory-only** olacaktır. Tasarım baştan backend-neutral kurulacak; Redis daha
sonra uygulama kodu değiştirilmeden L2, distributed coordination ve cross-pod invalidation için
etkinleştirilebilecektir.

## Güncel durum özeti — 21 Ağustos 2026

Bu bölüm gerçekleşen işi hedeflerden ayırır. Bir fazın kodunun tamamlanmış olması, tüketici uygulama
tarafından kullanılabilir bir package release'inin yayımlandığı anlamına gelmez.

| Alan                    | Durum                                                      | Açıklama                                                                                                                          |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| O1–O6                   | **Uygulandı ve yerel olarak doğrulandı; release bekliyor** | Kod, contract testleri, template ve dokümantasyon çalışma ağacında bulunuyor.                                                     |
| O7 memory matrisi       | **Uygulandı ve doğrulandı**                                | Cold/stale burst, negative cache, stale-if-error, byte eviction ve correctness kapısı memory-only çalışıyor.                      |
| O7 gerçek Redis matrisi | **CI doğrulaması bekliyor**                                | Yerel Docker çalışmadığı için gerçek Redis service matrisi yerelde koşturulamadı; release CI'ına zorunlu service olarak bağlandı. |
| OriginLoom release      | **Bekliyor**                                               | Paketler hâlâ `0.7.22`; son commit O1–O7'den önce. `0.7.23-cache-performance-acceptance` migration'ı henüz yayımlanmadı.          |
| Review kapanışı         | **Bekliyor**                                               | Island fallback ve migration sonucu gibi aşağıdaki `OR` maddeleri release öncesinde kapatılacak.                                  |
| S0–S7 (`sigorta`)       | **Başlanmadı**                                             | OriginLoom release edilmeden ve S0 parite kapısı geçilmeden uygulama cache migration'ı başlamayacak.                              |

Bu nedenle mevcut durum **“O1–O7 tamamen bitti ve tüketilebilir”** değildir. Doğru ifade:
**altyapı implementasyonu büyük ölçüde tamamlandı; review, gerçek Redis CI sonucu, commit ve `0.7.23`
publish adımları bekliyor.**

### Durum işaretleri

- `[x]`: Kod ve ilgili yerel doğrulama tamamlandı.
- `[~]`: Implementasyon tamamlandı; dış ortam, CI veya release doğrulaması bekliyor.
- `[ ]`: Henüz başlanmadı.

## Çalışma kuralları

- Her faz ayrı uygulanabilir, test edilebilir ve commit edilebilir olmalıdır.
- Bir fazın acceptance maddeleri tamamlanmadan bağımlı faza geçilmemelidir.
- OriginLoom package değişikliği gerekiyorsa önce altyapı fazı yayınlanır, ardından `sigorta` upgrade
  edilir.
- Shared cache'e yalnız public, deterministik ve bütün varyantları bounded key ile ifade edilmiş veri
  girebilir.
- Request ID, client IP, token, session ve kullanıcıya özel değerler shared HTML/data cache'e giremez.
- Performans kazanımı correctness, cache izolasyonu veya invalidation doğruluğu pahasına yapılamaz.
- Redis ilk fazların çalışması için zorunlu değildir; Redis uyumluluğu API ve wire-contract seviyesinde
  korunur.

---

# A. OriginLoom altyapı fazları

## O1 — Shared HTML dinamik alan kontratı

**Durum: `[x]` Uygulandı ve doğrulandı; package release'i bekliyor.**

### Amaç

Shared HTML içinde request'e özel değerlerin cache fill isteğinden sonraki ziyaretçilere taşınmasını
engellemek.

### Kapsam

- CSP nonce yaklaşımını genel bir dynamic HTML slot mekanizmasına dönüştürmek.
- `pageRequestId` değerini cache'e gerçek değer olarak değil placeholder olarak yazmak.
- HIT/STALE response oluşturulurken güncel request değerlerini materialize etmek.
- Eksik, bozuk veya güvenli formatta olmayan slot değerlerinde fail-safe davranmak.
- Route error ve global error render akışlarını aynı kontrata bağlamak.

### Kapsam dışı

- Shell parçalama.
- Genel fragment sistemi değişikliği.
- Data cache API'si.

### Acceptance

- [x] İki farklı request ID ile aynı HTML cache key'ine istek atıldığında her response kendi ID'sini taşır.
- [x] Cache body içinde gerçek request ID bulunmaz.
- [x] CSP nonce davranışı ve mevcut cache HIT/STALE testleri bozulmaz.
- [x] Memory ve Redis codec round-trip testleri slot bilgisini korur.

### Tamamlanma kaydı

- Cache-fill renderer'ı `pageRequestId` ve CSP nonce için gerçek değer yerine kapalı registry'deki
  placeholder'ları alır.
- Cache yazımında ikinci savunma katmanı olarak concrete request değerleri normalize edilir.
- HIT/STALE response materialization'ı yalnız güncel request'in doğrulanmış değerlerini kullanır.
- Unsafe veya bilinmeyen slot marker'ları browser'a taşınmadan fail-safe temizlenir.
- Memory ve Redis store akışında aynı cache key'ine iki farklı request ID testi eklendi.

### Bağımlılık

- Yok. İlk yapılabilecek OriginLoom fazıdır.

---

## O2 — Typed cached resource API'si

**Durum: `[x]` Uygulandı ve doğrulandı; package release'i bekliyor.**

### Amaç

Uygulamaların manuel `cache.read -> JSON.parse -> cache.write` uygulamasını kaldıran, memory-first ve
Redis-ready bir data-cache primitive'i sağlamak.

### Kapsam

- `defineCachedResource<T>` veya eşdeğer backend-neutral API.
- Versioned, namespaced ve deterministik key üretimi.
- Fresh, stale ve miss state machine.
- Process-local cold-fill single-flight.
- Stale hit'te detached background refresh.
- Request abort'undan bağımsız, kendi timeout'una sahip refresh context'i.
- Runtime validation/normalization ve versioned serialization codec'i.
- Başarılı negatif sonuç ile upstream error ayrımı.
- Opsiyonel negative TTL ve stale-if-error politikası.
- L1'de typed value, Redis L2'de serialized value desteği.
- Resource bazlı hit/miss/stale/refresh/coalescing/degradation metrikleri.
- Graceful shutdown sırasında resource revalidation drain desteği.

### Redis hazırlığı

- Uygulama API'si backend türünü bilmeyecek.
- Redis aktifken mevcut distributed lock ve L1 promotion imkânlarından yararlanılacak.
- Memory-only modda hiçbir Redis bağlantısı veya Redis'e özel zorunluluk olmayacak.

### Kapsam dışı

- Page HTML cache'ini bu API'ye taşımak.
- Byte-weighted L1 eviction.
- Dependency tag invalidation.

### Acceptance

- [x] Fresh hit loader çalıştırmaz.
- [x] Eşzamanlı cold miss'ler process başına tek loader çağrısına birleşir.
- [x] Stale burst eski değeri hızlı döndürür ve tek refresh başlatır.
- [x] Başarılı `not-found/no-content` sonucu policy'ye göre negatif cache'lenebilir.
- [x] Loader error negatif sonuç olarak cache'lenmez.
- [x] Corrupt veya eski codec version entry silinip cold miss kabul edilir.
- [x] Memory ve Redis store contract testleri aynı observable sonucu verir.

### Tamamlanma kaydı

- Backend-neutral typed resource primitive'i, versioned codec ve deterministic namespaced key üretimi
  eklendi.
- Fresh/stale/miss, negative result, stale-if-error, cold single-flight ve detached refresh semantiklerini
  kapsayan testler eklendi.
- Resource revalidation işleri graceful shutdown drain akışına bağlandı.
- Redis kullanımı uygulama API'sinden gizli tutuldu; memory-only kullanımda Redis zorunluluğu oluşmadı.

### Bağımlılık

- O1'den bağımsızdır; ancak uygulama migration'larından önce tamamlanmalıdır.

---

## O3 — Byte-weighted ve namespaced L1 memory cache

**Durum: `[x]` Uygulandı ve doğrulandı; package release'i bekliyor.**

### Amaç

Farklı büyüklükteki page, data ve fragment entry'lerinin aynı entry-count havuzunda birbirini
kontrolsüz biçimde dışarı atmasını engellemek.

### Kapsam

- Entry sayısına ek olarak gerçek veya güvenli tahmini byte weight ölçümü.
- Hit'te recency güncelleyen LRU davranışı.
- En az `page`, `data`, `fragment` ve `negative` namespace'leri.
- Global byte sınırı ve namespace başına bütçe/rezerv.
- Tek başına bütçeyi aşan entry için açık reject davranışı ve metriği.
- Expired entry cleanup stratejisi.
- Lock, ephemeral value ve rate-limit map'leri için bounded cleanup.
- Namespace bazlı current bytes, entry, eviction ve rejection metrikleri.

### Redis hazırlığı

- L1 limitleri Redis kapasitesinden bağımsız olacaktır.
- L2 hit'in L1'e promotion'ı namespace bütçelerine uymalıdır.
- Redis kullanılması L1'i devre dışı bırakmayacaktır.

### Kapsam dışı

- TinyLFU/admission algoritması; gerçek trafik LRU yetersizliğini gösterirse ayrıca değerlendirilir.
- Redis server memory policy yönetimi.

### Acceptance

- [x] Büyük entry'ler byte limitini aşamaz.
- [x] Bir namespace diğer namespace'in minimum rezervini tüketemez.
- [x] Hot entry hit aldıkça LRU'da korunur.
- [x] Expired auxiliary kayıtlar trafik olmasa bile bounded biçimde temizlenir.
- [x] Mevcut cache purge ve inspect API'leri çalışmaya devam eder.

### Tamamlanma kaydı

- Page, data, fragment ve negative namespace'leri byte-aware LRU politikasına bağlandı.
- Global limit, namespace rezervleri, oversized-entry rejection ve namespace metrikleri eklendi.
- L2'den L1'e promotion aynı namespace bütçelerine tabi tutuldu.
- Auxiliary map cleanup'ları entry sayısı ve süre açısından bounded hâle getirildi.

### Bağımlılık

- O2 sonrasında yapılması tercih edilir; typed resource namespace'lerini kullanır.

---

## O4 — Shell dependency planı ve paralel SSR yürütme

**Durum: `[x]` Uygulandı ve doğrulandı; package release'i bekliyor.**

### Amaç

Route loader tamamlandıktan sonra shell yükleme waterfall'ını kaldırmak ve request'e özel veriyi public
shell snapshot'ından yapısal olarak ayırmak.

### Kapsam

- Shell verisini kavramsal olarak şu katmanlara ayıran runtime kontratı:
  - `RequestFacts`
  - `PublicShellSnapshot`
  - `TargetedShell`
  - `RequestOverlay`
- Mevcut `buildShellData` için geriye uyumluluk dönemi.
- Loader ile bağımsız shell dependency'lerini eşzamanlı başlatmak.
- Redirect/not-found/error terminal sonucu geldiğinde gereksiz shell işini iptal etmek.
- Aynı render içinde aynı shell dependency'sini tek promise ile paylaşmak.
- Shell dependency sürelerini ayrı span/metric olarak ölçmek.

### Kapsam dışı

- Cached document içine fragment stitching.
- Ürüne özel menu veya HelloBar key'leri.

### Acceptance

- [x] Yapay gecikmeli loader ve shell testinde toplam süre toplama değil maksimum gecikmeye yaklaşır.
- [x] Terminal loader sonucu shell response'unu beklemez.
- [x] Eski runtime kullanan uygulamalar migration süresince çalışır.
- [x] Request overlay shared cache body'ye serialize edilmez.

### Tamamlanma kaydı

- Request facts, public snapshot, targeted shell ve request overlay ayrımı runtime kontratına işlendi.
- Loader'dan bağımsız shell dependency'leri paralel başlatılıyor ve aynı render içinde promise paylaşıyor.
- Terminal loader sonuçları gereksiz shell bekleyişine girmiyor.
- Legacy `buildShellData` yolu tüketici migration dönemi için korunuyor.

### Bağımlılık

- O1 tamamlanmış olmalıdır.
- O2 ile birlikte kullanılması önerilir, fakat zorunlu değildir.

---

## O5 — Fragment cache lifecycle ve composable document

**Durum: `[x]` Uygulandı ve doğrulandı; package release'i bekliyor.**

### Amaç

Farklı TTL'lere sahip page content, menu/header/footer ve targeted shell parçalarının kendi cache
ömürlerini koruyarak response anında birleştirilmesini sağlamak.

### Kapsam

- Fragment key'ini mümkünse full shell yüklenmeden hesaplamak.
- Fragment cold fill için single-flight.
- Fragment stale hit için detached SWR refresh.
- Aynı fragment bir document içinde birden fazla geçerse tek çözümleme.
- Shell gerektiren fragmentlerde shell dependency promise'ini paylaşmak.
- Cached document'te compiled marker planını korumak.
- Fragment fallback ve timeout davranışını açık hâle getirmek.

### Kapsam dışı

- React Server Components.
- Partial SSR veya route-level PPR.
- Browser tarafında fragment fetch etmek.

### Acceptance

- [x] Uzun TTL document içindeki kısa TTL fragment bağımsız yenilenir.
- [x] Fragment cold/stale burst tek fill/refresh üretir.
- [x] Fragment failure bütün document'i düşürmez ve tanımlı fallback'i kullanır.
- [x] Fragment içermeyen HIT yolu stitching maliyetine girmez.

### Tamamlanma kaydı

- Compiled marker planı cache codec'inde korunuyor ve aynı fragment document başına bir kez çözülüyor.
- Cold fill single-flight, stale SWR refresh, timeout ve tanımlı fallback lifecycle'ı eklendi.
- Shell isteyen fragmentler mevcut shell dependency promise'ini paylaşıyor.
- Fragment içermeyen cached document hızlı yolu stitching çözümlemesini atlıyor.

### Bağımlılık

- O2 ve O4 tamamlanmış olmalıdır.

---

## O6 — Dependency tag ve dağıtık invalidation modeli

**Durum: `[x]` Uygulandı ve doğrulandı; package release'i bekliyor.**

### Amaç

Bir data veya shell kaynağı değiştiğinde ona bağlı page/fragment entry'lerini en dar kapsamda
temizleyebilmek.

### Kapsam

- Stabil string tabanlı resource ve dependency tag'leri.
- Entry yazımında tag ilişkisinin kaydedilmesi.
- Exact key, namespace/prefix ve tag invalidation.
- Memory-only process-local invalidation.
- Redis aktifken pub/sub ile diğer podların L1 invalidation'ı.
- Release namespace'i ve rolling deploy davranışı.
- Inspect/purge API'sinde bounded tag operasyonları.

### Kapsam dışı

- CMS vendor'a özel webhook implementasyonu.
- Sınırsız dependency graph traversal.

### Acceptance

- [x] Menu tag purge ilgili menu fragment/page entry'lerini temizler, ilgisiz data cache'i etkilemez.
- [x] Memory-only ve memory+Redis contract testleri aynı invalidation sonucunu verir.
- [x] Pub/sub reconnect sonrasında güvenli L1 flush/recovery davranışı korunur.
- [x] Tag cardinality ve purge boyutu bounded'dır.

### Tamamlanma kaydı

- Exact key, namespace/prefix ve stabil dependency tag invalidation eklendi.
- Memory-only local invalidation ve Redis pub/sub üzerinden cross-pod L1 invalidation aynı API'yi kullanıyor.
- Rolling deploy için release namespace davranışı ve reconnect sırasında güvenli L1 recovery tanımlandı.
- Inspect/purge yollarında tag cardinality ve purge iş miktarı sınırlandı.

### Bağımlılık

- O2 ve O3 tamamlanmış olmalıdır.
- O5 ile beraber gerçek page/fragment dependency'lerinde kullanılır.

---

## O7 — Cache performans kabul paketi ve Redis regresyon matrisi

**Durum: `[~]` Implementasyon tamamlandı; memory doğrulandı, gerçek Redis CI sonucu ve release bekliyor.**

### Amaç

Cache davranışını yalnız unit testlerle değil cold/stale burst, payload, memory ve topology bazında
release kapısına dönüştürmek.

### Kapsam

- Memory-only senaryoları:
  - cold burst
  - stale burst
  - negative cache
  - stale-if-error
  - byte eviction
- Redis senaryoları:
  - cross-process cold fill
  - distributed revalidation
  - L2 promotion
  - pub/sub invalidation
  - optional/required degradation
- Cache response latency, gateway protection ratio ve event-loop ölçümleri.
- Identity ve gzip/ingress compression profillerini ayırmak.
- Create-app template, dokümantasyon ve upgrade migration güncellemeleri.

### Acceptance

- [x] Memory-only bütün temel cache semantiklerini Redis olmadan sağlar.
- [x] Redis açıldığında uygulama kaynak kodu değişmez.
- [x] Cache correctness deneyi başarısızsa performans baseline'ı kabul edilmez.
- [x] Template'ten üretilen uygulama yeni cache API'sini örnekler.
- [~] Gerçek Redis service ile cross-process cold fill, distributed revalidation, L2 promotion,
  pub/sub invalidation ve degradation matrisi release CI'da başarıyla tamamlanır.

### Tamamlanma ve bekleyen doğrulama kaydı

- Memory-only correctness/performance runner'ı ve ayrı identity/gzip profilleri eklendi.
- Cache correctness sonucu performans baseline kabulünün ön koşulu yapıldı.
- Create-app template, performans dokümantasyonu ve `0.7.23-cache-performance-acceptance` migration'ı
  hazırlandı.
- Redis senaryoları release CI'a zorunlu Redis service ile bağlandı.
- Yerel Docker çalışmadığı için gerçek Redis matrisi yerelde çalıştırılamadı; CI sonucu görülmeden O7
  tamamen doğrulanmış veya release-ready sayılmayacak.

### Bağımlılık

- O1–O6 tamamlandıktan sonra nihai release kapısıdır.

---

## OR — OriginLoom review kapanışı ve `0.7.23` release kapısı

**Durum: `[ ]` Başlanmadı. `sigorta` S0'dan ve `0.7.23` publish işleminden önce zorunludur.**

### Amaç

O1–O7 uygulamasından sonra yapılan yapısal review'de doğrulanan platform sorunlarını gidermek, yanlış
pozitifleri gerekçeli karar olarak kaydetmek ve cache performans paketini tüketiciye güvenle açmak.

### Zorunlu düzeltmeler

#### OR1 — Migration sonucunun sessizce başarılı sayılmasını engellemek

- `patchProjectFile` ve migration patch kontratı `patched`, `already-applied` ve `manual-required`
  sonuçlarını ayırt edecek.
- `server/product/boundary-pages.tsx` mevcut ama bilinen generated kalıba uymuyorsa migration dosyayı
  geniş regex ile değiştirmeye çalışmayacak.
- Böyle bir custom dosya için plan, dosya yolunu ve gerekli `errorId` prop değişikliğini açıkça
  `manual-required` olarak raporlayacak.
- `manual-required` kalan migration `.originloom/project.json` içinde uygulanmış sayılmayacak ve
  `origin:doctor --strict` pending durumu göstermeye devam edecek.
- Bilinen generated kalıp ve zaten uygulanmış kalıp idempotent çalışmaya devam edecek.

#### OR2 — Island hata referansını SSR içeriğini koruyarak göstermek

- Island yükleme veya mount hatasında island root'un `textContent` değeriyle SSR DOM'u silinmeyecek.
- Görünür, PII-free `errorId` referansı island root'un dışında ayrı, erişilebilir ve tekrar eklenmeyen
  bir status/alert elementiyle gösterilecek.
- Root üzerinde makine tarafından okunabilen `data-error-reference` tutulabilecek.
- Başarılı retry/mount durumunda hata status elementi ve stale hata attribute'ları temizlenecek.
- Kullanıcıya gösterilen metin platform içine sabit Türkçe string olarak gömülmeyecek; runtime callback
  veya app-owned formatter ile üretilecek. Create-app template güvenli bir varsayılan sağlayacak.
- Chunk/module bulunamaması gibi pre-mount hatalarında kullanılabilir SSR içerik korunacak; gerçek
  component failure için ürünün seçebileceği açık fallback kontratı bulunacak.

### Bakım ve CLI sağlamlaştırmaları

#### OR3 — Request ID header sahipliğini tek noktaya indirmek

- Hono uygulama sınırında final response'u saran request-id middleware tek kaynak olarak kullanılacak.
- `ssr-dispatch.ts` içindeki aynı response'a yapılan tekrar `x-request-id` set işlemleri kaldırılacak.
- Hono dışında doğrudan kullanılabilen standalone `handle`/response API'leri kendi header garantisini
  koruyacak.
- Cache HIT, HEAD, pipeline short-circuit, capacity rejection, redirect, not-found ve error yolları app
  sınırında tek contract testiyle doğrulanacak.

#### OR4 — Gateway scaffold argüman ve fixture sınırları

- Değer isteyen her CLI flag için ortak boundary kontrolü eklenecek; `--cwd`, `--id`, `--fixture` gibi
  değersiz seçenekler genel TypeError yerine seçenek adını içeren hata verecek.
- Fixture JSON bütün olarak parse edilmeye devam edecek; streaming parser eklenmeyecek.
- Yanlışlıkla çok büyük stdin veya fixture verilmesine karşı açık maksimum byte sınırı eklenecek ve
  hata mesajında limit bildirilecek.

#### OR5 — Production placeholder sentinel kapsamı

- Mevcut exact sentinel davranışı korunacak; normal release ID içinde geçen sıradan `todo` parçaları
  reddedilmeyecek.
- `CHANGE_ME`, `REPLACE_ME` gibi underscore/separator varyantları exact placeholder listesine eklenecek.
- Secret ve release alanları için kabul/reddetme matrisi testle belgelenecek.

### Test ve politika açıklamaları

- Stream shell render, route error render ve global static error response zincirinin art arda hata
  durumunu kapsayan hedefli test eklenecek. Global fallback React renderer'a bağlı olmayacak.
- `wait_timeout` için `Retry-After: 2` değerinin elapsed queue süresi değil istemci backoff politikası
  olduğu yorum veya dokümantasyonla açıklanacak. Operasyonel veri ihtiyaç gösterirse ayrı config yapılacak.
- Pretty log'daki sekiz karakterlik ID yalnız geliştirme görünümüdür; structured JSON tam `requestId`
  ve `pageRequestId` değerlerini taşımaya devam edecek.

### Review karar kaydı

Bu kayıt aynı bulguların daha sonra yeniden açık sanılmasını önler:

| Review | Karar                         | Gerekçe / yapılacak işlem                                                                                                                                                                                          |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S-1    | **Değişiklik yok**            | O1 placeholder pipeline'a bağlıdır; cache-fill render placeholder alır, write normalize eder, HIT/STALE güncel ID'yi materialize eder. Memory/Redis testleri gerçek fill ID'nin cache body'de olmadığını doğrular. |
| S-2    | **Değişiklik yok**            | `isSafeRequestId` ikinci kontrolü, dışarıdan/testten kurulabilen context için ucuz boundary defense'tır.                                                                                                           |
| S-3    | **Test eklenecek**            | Fallback zinciri vardır; iki ardışık renderer failure yolu ayrıca regresyon testiyle sabitlenecek.                                                                                                                 |
| S-4    | **OR3'te düzeltilecek**       | Correctness açığı değil, final request-id middleware varken gereksiz sahiplik ve tekrar problemidir.                                                                                                               |
| S-5    | **Değişiklik yok**            | HEAD ve GET birbirini dışlayan dallardır; tek request içinde `buildContext` iki kez çalışmaz.                                                                                                                      |
| S-6    | **Değişiklik yok**            | `CookieJar` request/use başına kurulur; `NODE_ENV` boot-time state'tir ve runtime sırasında değişmemelidir.                                                                                                        |
| S-7    | **Açıklama eklenecek**        | Sabit `2`, queue wait süresi değil retry backoff politikasıdır; ölçüm olmadan yeni config eklenmeyecek.                                                                                                            |
| S-8    | **OR5'te sağlamlaştırılacak** | Mevcut `todo` kontrolü prefix değil exact eşleşmedir; gerçek eksik separator'lı placeholder varyantlarıdır.                                                                                                        |
| S-9    | **Değişiklik yok**            | Her logda `isTTY` okumak anlamlı sıcak-yol maliyeti değildir; dinamik stream/test davranışını korur.                                                                                                               |
| S-10   | **Değişiklik yok**            | Sekiz karakter yalnız pretty görünümde kullanılır; production structured log tam ID taşır.                                                                                                                         |
| S-11   | **OR2'de düzeltilecek**       | `textContent` SSR island içeriğini yıkıcı biçimde silmektedir.                                                                                                                                                     |
| S-12   | **OR2'de düzeltilecek**       | Platform seviyesindeki sabit Türkçe mesaj app-owned/i18n formatter'a taşınmalıdır.                                                                                                                                 |
| S-13   | **OR4'te bounded hardening**  | JSON sonunda bütün olarak parse edilir; streaming kazanç sağlamaz, fakat maksimum input boyutu gerekir.                                                                                                            |
| S-14   | **OR4'te düzeltilecek**       | Değersiz CLI flag'leri seçenek-spesifik ve deterministik hata vermelidir.                                                                                                                                          |
| S-15   | **OR1'de zorunlu düzeltme**   | Patch eşleşmediğinde migration şu anda sessizce applied sayılabilmektedir.                                                                                                                                         |
| S-16   | **Değişiklik yok**            | `patchClientEntry(next)` repair edilmiş kaynağı korur; tarif edilen original-source rollback oluşmaz. Gelecek source migration'ları yine explicit sonuç kontratını kullanacaktır.                                  |
| S-17   | **Değişiklik yok**            | Non-production merge mevcut `secure: true` değerini korur; production target yalnız `secure: true` zorlar.                                                                                                         |

### Acceptance

- [ ] Custom boundary dosyası sessizce skip edilip migration uygulanmış sayılamaz.
- [ ] Island module/mount hatasında SSR içeriği korunur ve kullanıcı PII-free referansı görür.
- [ ] Island hata mesajı uygulama tarafından yerelleştirilebilir.
- [ ] Bütün app response yolları final request ID header contract testinden geçer.
- [ ] Eksik CLI option value ve oversized fixture testleri geçer.
- [ ] İki aşamalı route/global error fallback regresyon testi geçer.
- [ ] O1–O7 ilgili testleri OR değişikliklerinden sonra tekrar geçer.
- [ ] Zorunlu gerçek Redis CI matrisi yeşildir.

### Bağımlılık

- O1–O7 implementasyonu tamamlanmış olmalıdır.
- OR tamamlanmadan O1–O7 commit/release kapanışı ve `0.7.23` publish yapılmaz.

---

# B. `sigorta` uygulama fazları

## S0 — Platform upgrade ve davranış paritesi

**Durum: `[ ]` Başlanmadı. İlk `sigorta` fazıdır.**

### Amaç

`sigorta` uygulamasını yayımlanmış cache performans altyapısına kontrollü biçimde yükseltmek ve yeni
cache modellerine geçmeden önce mevcut davranışın değişmediğini kanıtlamak.

### Kapsam

- OriginLoom `0.7.23` release/publish işleminin ve release notlarının tamamlandığını doğrulamak.
- `sigorta` içindeki bütün fixed-group `@originloom/*` dependency'lerini aynı yayımlanmış sürüme çekmek.
- `pnpm origin:migrate --apply` çalıştırmak; manual-required migration varsa ilerlemeden çözmek.
- Lockfile'ı yeni dependency graph ile yeniden üretmek.
- `origin:doctor --strict`, typecheck, build, test ve smoke kapılarını çalıştırmak.
- Upgrade öncesi ve sonrası mevcut page/data cache davranışını karşılaştırmak:
  - cache key'leri,
  - HIT/MISS/STALE header'ları,
  - mevcut TTL/SWR değerleri,
  - upstream gateway call sayısı,
  - public/private/no-store sınırları,
  - error ve fallback davranışı.
- İlk deployment ve S1–S7 geliştirme başlangıcında `CACHE_BACKEND=memory` kullanmak.
- O3 global ve namespace L1 byte bütçelerini varsayılanla körlemesine açmamak; `sigorta` trafik, payload,
  RSS ve entry cardinality ölçülerinden başlangıç bütçesi çıkarmak.
- Redis'i uygulama kodunu değiştirmeden sonradan açılabilecek opsiyonel L2 olarak kapalı tutmak.

### Kapsam dışı

- Menu veya HelloBar cache implementasyonunu değiştirmek.
- Yeni page/fragment cache açmak.
- Redis'i production için zorunlu yapmak.
- S1–S7 optimizasyonlarını upgrade commit'ine karıştırmak.

### Acceptance

- [ ] `sigorta` yalnız yayımlanmış ve aynı sürümdeki OriginLoom fixed-group paketlerini kullanır.
- [ ] Pending veya manual-required migration kalmaz.
- [ ] Lockfile, doctor, typecheck, build, test ve smoke kapıları geçer.
- [ ] Upgrade öncesi/sonrası davranış parite raporunda açıklanmamış cache farkı yoktur.
- [ ] Başlangıç backend'i memory'dir; Redis bağlantısı zorunlu değildir.
- [ ] Page/data/fragment/negative L1 bütçeleri ölçüm kaynağı ve güvenli üst sınırlarıyla belgelenmiştir.
- [ ] S0 tek başına geri alınabilir bir dependency/migration commit'i olarak tamamlanır.

### Bağımlılık

- OR release kapısı ve gerçek Redis CI matrisi tamamlanmış olmalıdır.
- O1–O7 commit edilmiş, `0.7.23` version/release/publish işlemleri tamamlanmış olmalıdır.

---

## S1 — Shared HTML doğruluk ve kişisel veri sınırı

**Durum: `[ ]` Başlanmadı.**

### Amaç

Yeni cache alanları açmadan önce mevcut shared home HTML'in her ziyaretçi için güvenli ve deterministik
olmasını sağlamak.

### Kapsam

- `clientIp` alanını `ShellData` ve newsletter island props'undan çıkarmak.
- Newsletter/permit BFF'nin IP'yi yalnız server context'inden çözmesi.
- Home cache'te farklı IP'lerin aynı public HTML'i aldığını test etmek.
- HelloBar campaign cookie'sinin home document varyantına etkisini çözmek:
  - bounded targeting sınıfı,
  - targeted fragment,
  - veya kampanyalı request için cache bypass.
- Gerçek request ID'nin shared cache body'ye girmediğini doğrulamak.
- Kullanılmayan request-specific shell alanlarını kaldırmak veya request overlay'e taşımak.

### Kapsam dışı

- Kasko/MTV full-page cache açmak.
- Menu ve HelloBar servislerini yeni data-cache API'sine taşımak.

### Acceptance

- [ ] İki IP, iki request ID ve kampanyalı/kampanyasız ziyaretçi matrisi cache izolasyon testinden geçer.
- [ ] Browser'dan gönderilen IP permit log için kaynak kabul edilmez.
- [ ] Shared HTML'de kişisel/request-scoped değer bulunmaz.

### Bağımlılık

- S0 tamamlanmış olmalıdır.
- O1'in yayımlanmış dynamic HTML slot kontratı kullanılmalıdır.
- Bu fazdaki `clientIp`, campaign ve request ID çalışmaları aynı başlangıç parite ölçümüne göre
  doğrulanmalıdır; artık yayımlanmamış O1 beklenerek paralel başlanmayacaktır.

---

## S2 — Mevcut manuel data cache'lerin migration'ı

**Durum: `[ ]` Başlanmadı.**

### Amaç

Mevcut cache örneklerini gerçek SWR, single-flight ve typed L1 davranışına geçirmek.

### Kapsam

- Menu cache'ini typed cached resource'a taşımak.
- HelloBar cache'ini typed cached resource'a taşımak.
- Zorunlu trafik page-data cache'ini typed cached resource'a taşımak.
- Redirect decision cache'ini merkezi primitive'e taşımak veya aynı lifecycle kontratına bağlamak.
- `parsedSnapshots` ve servis-local yardımcı cache map'lerini kaldırmak.
- Public loader'larda identity header gereksinimini endpoint bazında yeniden sınıflandırmak.
- Her resource'a ilk migration sırasında stabil, string tabanlı dependency tag'leri vermek; O6 hazır
  olduğu için tagsiz geçici model oluşturup sonradan ikinci migration yapmamak.
- Resource name, key version ve tag isimlerini tek registry'de belgelemek.

### HelloBar özel kuralları

- Başarılı "banner yok" sonucu kısa negative TTL ile cache'lenir.
- Gateway error cache'lenmez.
- Raw campaign/path cardinality'si bounded politika ile kontrol edilir.
- Campaign key'i hash'lenerek yalnız gizlenmez; gerçek key uzayı sınırlandırılır.

### Acceptance

- [ ] Her resource için fresh, stale, cold burst, corrupt payload ve upstream error testi vardır.
- [ ] Stale burst tek background refresh üretir.
- [ ] Cold burst process başına tek gateway call üretir.
- [ ] HelloBar olmayan sayfalar her request'te gateway'e gitmez.
- [ ] Her resource stabil dependency tag taşır; tag/key version registry'si test ve dokümantasyonda aynıdır.

### Bağımlılık

- S0 tamamlanmış olmalıdır.
- O2 typed resource ve O6 dependency tag API'leri yayımlanmış OriginLoom sürümünden kullanılmalıdır.

---

## S3 — Shell snapshot ve render-ready projection

**Durum: `[ ]` Başlanmadı.**

### Amaç

Menu ve shell verisini her SSR render'ında tekrar dönüştürmemek ve route loader ile paralel yüklemeye
hazırlamak.

### Kapsam

- Sigorta shell'ini public snapshot, targeted content ve request overlay olarak ayırmak.
- Menu desktop/mobile projection'larını snapshot değişene kadar yeniden kullanmak.
- Header, drawer ve footer sorting işlemlerini render sıcak yolundan çıkarmak.
- Route loader ile menu/HelloBar dependency'lerini paralel başlatmak.
- `minimalChrome` route'ların gereksiz shell dependency'si başlatmamasını sağlamak.

### Acceptance

- [ ] Menu snapshot değişmedikçe sorting/projection bir kez çalışır.
- [ ] MTV gibi cache'siz route'larda loader ve shell gateway süreleri waterfall oluşturmaz.
- [ ] Minimal chrome recourse route'u menu/HelloBar çağırmaz.
- [ ] Shell dependency süreleri benchmark raporunda ayrı görülebilir.

### Bağımlılık

- O4 ve S2 tamamlanmış olmalıdır.

---

## S4 — Menu ve HelloBar'ı document TTL'inden ayırma

**Durum: `[ ]` Başlanmadı.**

### Amaç

Home document cache'in menu ve HelloBar TTL'lerini ezmesini önlemek.

S2 ile sınır nettir: **S2 gateway/CMS sonucunun typed data snapshot lifecycle'ıdır; S4 bu snapshot'tan
üretilen render edilmiş HTML fragmentlerinin document'ten bağımsız lifecycle'ıdır.** S4, S2'nin yerine
geçmez ve aynı veriyi ikinci bir manuel data cache'te tutmaz.

### Kapsam

- Menu/header/footer için device-bounded cached fragment.
- HelloBar için pathname, device ve güvenli targeting boyutlu kısa ömürlü fragment.
- Home document'in yalnız stabil content/placeholder saklaması.
- Fragment fallback'lerinin erişilebilir ve layout-safe olması.
- Menu ve HelloBar purge davranışının ayrı doğrulanması.

### Acceptance

- [ ] Home document HIT kalırken HelloBar kendi TTL'sinde değişebilir.
- [ ] Menu refresh/purge page data loader'ını çalıştırmaz.
- [ ] HelloBar refresh/purge menu cache'ini düşürmez.
- [ ] Kampanyalı içerik kampanyasız ziyaretçiye servis edilmez.
- [ ] Fragment render'ı S2 resource snapshot'ını kullanır; paralel ikinci gateway/data cache yolu açmaz.

### Bağımlılık

- O5, S1 ve S3 tamamlanmış olmalıdır.

---

## S5 — Public page data ve MTV lookup cache genişletmesi

**Durum: `[ ]` Başlanmadı.**

### Amaç

Full-page cache'e uygun olmayan route'larda dahi gateway ve render hazırlık maliyetini azaltmak.

### Kapsam

- Kasko public page data cache.
- MTV public page data cache.
- MTV vehicle types cache.
- Bounded GET lookup cache'leri:
  - vehicle ages
  - engine capacities
  - vehicle values
  - bus seatings
  - max weights
- Gateway DTO'yu cache'lemek yerine uygun yerlerde doğrulanmış render-ready view model üretmek.
- Public lookup response'larında ürün kararı uygunsa ETag veya kısa browser-private cache.
- Numeric lookup key'leri için domain/range/cardinality sınırı.

### Kesinlikle cache dışı

- MTV calculation POST.
- Newsletter subscribe ve permit log.
- Recourse mutation/forward POST.
- Kullanıcı/session/token bağımlı sonuçlar.

### Acceptance

- [ ] Warm data-cache route gateway çağrısını ortadan kaldırır.
- [ ] Cold/stale burst gateway'i tek fill/refresh ile korur.
- [ ] Geçersiz veya sınırsız lookup ID cache entry'si oluşturmaz.
- [ ] Mutation endpoint'leri `private, no-store` kalır.
- [ ] Lookup cardinality ve byte kullanımı O3 namespace bütçesi altında ölçülür; oversized/rejection
      metrikleri kabul edilen eşik içindedir.

### Bağımlılık

- O2, O3 ve S2 tamamlanmış olmalıdır.
- O3 byte-bounded L1 production ön koşuludur. Lookup cache'leri yalnız entry-count veya unbounded map ile
  production'a açılamaz.

---

## S6 — Dependency invalidation ve içerik publish akışı

**Durum: `[ ]` Başlanmadı.**

### Amaç

CMS/menu/HelloBar değişikliklerinde tüm cache'i temizlemeden doğru entry'leri yenilemek.

### Kapsam

- Sigorta resource ve page tag registry'si.
- Örnek ilişkiler:
  - `home -> insurance-home`
  - `home-shell -> menu`
  - `home-hellobar -> hellobar:/`
  - `zorunlu-trafik -> page-data:zorunlu-trafik`
- Operations purge API ile exact resource/tag temizliği.
- İçerik publish webhook'u varsa bounded tag mapping.
- Deploy namespace ve same-release content update runbook'u.

### Acceptance

- [ ] Menu publish yalnız menu bağımlı fragmentleri düşürür.
- [ ] Bir page-data publish ilgisiz page/data cache'lerini etkilemez.
- [ ] Memory-only purge aynı process'te deterministiktir.
- [ ] Redis açıldığında aynı tag purge diğer podların L1'ine yayılır.

### Bağımlılık

- O6, S4 ve S5 tamamlanmış olmalıdır.

---

## S7 — Page cache kararları ve gerçek performans kabulü

**Durum: `[ ]` Başlanmadı.**

### Amaç

Data ve shell cache'leri doğrulandıktan sonra hangi sigorta route'larının full-page cache'e alınacağına
ölçümle karar vermek.

### Kapsam

- Home, zorunlu trafik, Kasko ve MTV için karşılaştırılabilir benchmark matrisi.
- Her route için:
  - HTML determinism testi
  - user/campaign/device varyant testi
  - identity response boyutu
  - gzip veya gerçek ingress compression profili
  - cold/warm/stale RPS ve p95/p99
  - gateway protection ratio
  - RSS, L1 byte kullanımı ve eviction
- Kasko ve zorunlu trafik gibi public route'larda full-page cache kararını ölçüm sonrası vermek.
- MTV'de stabil page gövdesi ile dinamik hesaplama island sınırını doğrulamak.
- Accepted baseline ve release blocking regression eşikleri.
- Identity ve gzip/ingress sonuçlarını aynı dosyada karıştırmamak; ayrı ham sonuç ve baseline dosyaları
  tutmak.
- Her baseline artefact'ını aynı run'ın cache correctness raporuna bağlamak.

### Acceptance

- [ ] Cache açılan her route public ve deterministiktir.
- [ ] Cache key boyutları bounded ve belgelenmiştir.
- [ ] Performans raporu cache status ve gerçek gateway call sayısını birlikte gösterir.
- [ ] Identity ve gzip/ingress baseline'ları ayrı dosyalarda saklanır ve birbirinin yerine kıyaslanmaz.
- [ ] Aynı koşunun başarılı cache correctness raporu yoksa hiçbir latency/RPS baseline'ı kabul edilmez.
- [ ] Correctness deneyi başarısız route için baseline kabul edilmez.

### Bağımlılık

- S1–S6 tamamlanmış olmalıdır.
- O7'nin test/rapor altyapısını kullanır.

---

# C. Gerçekleşen durum ve zorunlu uygulama sırası

## Tamamlanan OriginLoom implementasyon kaydı

Bu tablo silinmemiş tarihsel kayıttır; aşağıdaki işler yeniden planlanacak işler değil, mevcut çalışma
ağacında tamamlanan implementasyonlardır.

| Faz | Repo       | Durum | Çıktı                                                      |
| --- | ---------- | ----- | ---------------------------------------------------------- |
| O1  | OriginLoom | `[x]` | Shared HTML request slot güvenliği                         |
| O2  | OriginLoom | `[x]` | Typed cached resource primitive                            |
| O3  | OriginLoom | `[x]` | Byte-weighted namespaced L1                                |
| O4  | OriginLoom | `[x]` | Shell dependency planı ve paralel SSR                      |
| O5  | OriginLoom | `[x]` | Fragment lifecycle ve composable document                  |
| O6  | OriginLoom | `[x]` | Dependency tag ve dağıtık invalidation                     |
| O7  | OriginLoom | `[~]` | Memory kabul paketi hazır; gerçek Redis CI sonucu bekliyor |

## Bundan sonraki zorunlu sıra

CI yalnız committed revision çalıştırabildiği için gerçek Redis sonucu, release candidate commit'i
push edildikten sonra alınabilir. Esas kural, Redis sonucu görülmeden version/publish yapılmamasıdır.

| Sıra | Faz / kapı                          | Repo       | Durum | Çıktı ve çıkış koşulu                                                                                                                            |
| ---: | ----------------------------------- | ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
|    1 | OR1–OR5                             | OriginLoom | `[ ]` | Review düzeltmeleri ve gerekçeli no-change kararları uygulanır.                                                                                  |
|    2 | Yerel release candidate doğrulaması | OriginLoom | `[ ]` | İlgili testler, typecheck, lint, format, build, migration ve memory acceptance kapıları geçer.                                                   |
|    3 | O1–O7 + OR commit kapanışı          | OriginLoom | `[ ]` | Değişiklikler anlamlı commit(ler)e alınır; çalışma ağacında bu kapsama ait unutulmuş dosya kalmaz.                                               |
|    4 | O7 gerçek Redis CI                  | OriginLoom | `[ ]` | Committed revision push edilir; zorunlu Redis service matrisi yeşil olur. Hata varsa release yapılmadan düzeltme commit'i ve CI tekrarı gerekir. |
|    5 | `0.7.23` version/release/publish    | OriginLoom | `[ ]` | Paket sürümleri, changelog, migration belgesi, release verify, registry publish ve yayımlanmış paket tüketim kontrolü tamamlanır.                |
|    6 | S0                                  | sigorta    | `[ ]` | Published platform upgrade, migrate ve mevcut davranış paritesi tamamlanır; backend memory kalır.                                                |
|    7 | S1                                  | sigorta    | `[ ]` | Shared HTML doğruluk ve kişisel veri sınırı kapatılır.                                                                                           |
|    8 | S2                                  | sigorta    | `[ ]` | Manuel data cache'ler typed resource + stabil dependency tag'lere taşınır.                                                                       |
|    9 | S3                                  | sigorta    | `[ ]` | Public/targeted/overlay shell ayrımı ve paralel dependency yürütme tamamlanır.                                                                   |
|   10 | S4                                  | sigorta    | `[ ]` | Render edilmiş Menu/HelloBar fragment lifecycle'ı document TTL'inden ayrılır.                                                                    |
|   11 | S5                                  | sigorta    | `[ ]` | O3 byte bütçesi altında public page-data ve bounded lookup cache'leri açılır.                                                                    |
|   12 | S6                                  | sigorta    | `[ ]` | Resource/page/fragment dependency invalidation ve publish akışı bağlanır.                                                                        |
|   13 | S7                                  | sigorta    | `[ ]` | Correctness'e bağlı identity/gzip performans baseline'ları ve page-cache kararları kabul edilir.                                                 |

## Commit ve release yaklaşımı

- O1–O7 kodu mevcut çalışma ağacında tamamlandığı için geçmiş işi silip yeniden üretmek yerine mevcut
  değişiklikler kontrat sınırlarına göre gözden geçirilip commit edilecektir.
- OR1/OR2 gibi release correctness değişiklikleri cache performans kodundan ayrı commit olabilir; ancak
  hepsi aynı `0.7.23` release candidate üzerinde test edilmelidir.
- Public API veya template değiştiren `O*` fazı semver release ve migration notu ile yayınlanmalıdır.
- `0.7.23` publish öncesinde package version, changelog, `docs/migrations/0.7.23.md`, create-app template,
  upgrade migration ve export surface birbiriyle uyumlu olmalıdır.
- Gerçek Redis CI matrisi başarısızken release tag'i veya registry publish yapılmaz.
- Publish sonrası temiz bir tüketici install/upgrade provası yayımlanmış registry paketleriyle yapılır;
  yalnız workspace linkleriyle geçen test release kanıtı sayılmaz.
- S0 ayrı dependency/migration/parite commit'i, her S1–S7 fazı da ayrı `sigorta` commit'i olmalıdır.
- Bir OriginLoom release'ine birden fazla altyapı fazı konabilir; ancak acceptance sonuçları ve migration
  birbirinden ayrılmalıdır.
- Redis production'da hemen etkinleştirilmese bile O2, O3, O6 ve O7 Redis contract testlerini taşımalıdır.

## `0.7.23` release tamamlanma tanımı

- [ ] OR acceptance maddeleri tamamlandı.
- [ ] O1–O7 ve OR için hedefli testler ile repository release kapıları geçti.
- [ ] Gerçek Redis CI matrisi aynı release candidate commit'i üzerinde yeşil.
- [ ] Bütün fixed-group OriginLoom paketleri `0.7.23` olarak versionlandı.
- [ ] Migration ve release notları yayımlanacak davranışı doğru anlatıyor.
- [ ] Registry publish tamamen başarılı ve paketler dışarıdan çözülebiliyor.
- [ ] Temiz scaffold ve desteklenen eski proje upgrade provası published paketlerle geçti.
- [ ] Ancak bu maddelerden sonra O1–O7 durumu “published/tüketilebilir” olarak güncellendi.

## Şimdilik yapılmayacaklar

- Redis'i ilk deployment için zorunlu yapmak.
- Partial SSR veya PPR tasarlamak.
- Her route'u otomatik full-page cache'e almak.
- Mutation veya kullanıcıya özel API cevaplarını cache'lemek.
- Profiling kanıtı olmadan precompression, karmaşık admission algoritması veya düşük seviye HTML byte
  optimizasyonuna girmek.
