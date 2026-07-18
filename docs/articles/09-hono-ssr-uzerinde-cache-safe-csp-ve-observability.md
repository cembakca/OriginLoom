# Hono SSR Üzerinde Cache-Safe CSP ve Observability Metrikleri

> Yüksek trafikli ve HTML önbellekleme (caching) uygulayan bir SSR mimarisinde güvenlik ve gözlemlenebilirlik (observability) sıradan yöntemlerle çözülemez. Bu makale, Hono BFF ve Vite dev sunucu ortamında cache-safe CSP, Permissions-Policy ve doğru telemetry metrik sekanslarının nasıl kurulduğunu anlatmaktadır.

---

Yüksek trafik hedefleyen web platformlarında sunucu yükünü azaltmak ve yanıt sürelerini mikrosaniyelere düşürmek için tam sayfa HTML önbelleklemesi (HTML caching) yaygın bir yöntemdir. Ancak, sayfa çıktısı bir kez üretilip Redis veya in-memory cache'e yazıldığında ve sonraki binlerce isteğe doğrudan bu cache'den servis edildiğinde iki kritik problem ortaya çıkar:

1. **Güvenlik (CSP Nonce Çelişkisi)**: İstek başına üretilen geleneksel CSP `nonce` değerleri cache'lenerek static hale gelir ve güvenlik işlevini tamamen yitirir.
2. **Gözlemlenebilirlik (Metric Semantics)**: Önbellekten dönen (`HIT`) istekler ile sunucuda render edilen (`MISS`/`STALE`) isteklerin ve arka plandaki kuyruk yapılarının telemetry metrikleri doğru ayrıştırılmalıdır.

---

## 1. Cache-Safe Content Security Policy (CSP)

HTML çıktılarının cache'lendiği sistemlerde istek başına rastgele `nonce` (number used once) üretmek ve bunu HTML içerisine enjekte etmek imkansızdır. Cache'lenen `nonce` statikleşeceği için saldırganlar tarafından bypass edilebilir.

Bu mimaride çözüm: **Deterministik SHA-256 script hashing** ve **GTM allowlist** yaklaşımıdır.

### Deterministik SHA-256 Hash Hesabı

Sayfa yüklenirken ilk koşan inline scriptlerin (early tracking, event queue, dataLayer init, GTM loader vb.) string içerikleri sunucu tarafında ve tarayıcı tarafında tamamen deterministiktir. 

Projemizde bu betiklerin tam içerikleri [gtm-bootstrap.tsx](file:///Users/cembakca/Downloads/files/ssr-kit/src/components/analytics/gtm-bootstrap.tsx) bileşeninden dışa aktarılarak güvenlik katmanıyla paylaşılmıştır. Sunucu ayağa kalkarken (startup / module load time) bu betiklerin SHA-256 hash'leri Node.js `crypto` modülü kullanılarak base64 formatında hesaplanır:

```ts
function sha256(content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("base64");
  return `'sha256-${hash}'`;
}
```

Bu yaklaşım sayesinde istek anında (request-time) herhangi bir hash hesaplama maliyeti oluşmaz. O(1) CPU performansı ile yüksek trafik altında ek yük yaratılmaz.

---

## 2. Geliştirme Ortamı (Vite Dev Server) ile Uyum

CSP standartlarında (CSP Level 2/3) kritik bir kural vardır:

> Eğer `script-src` kural kümesinde herhangi bir **hash** veya **nonce** bulunuyorsa, tarayıcılar güvenlik nedeniyle `'unsafe-inline'` anahtar kelimesini otomatik olarak **yok sayar (ignore eder)**.

Yerel geliştirme ortamında (`npm run dev`) Vite dev sunucusu (HMR) ve React Refresh mekanizmaları sayfaya dinamik olarak inline betikler enjekte eder. Eğer GTM hash'leri geliştirme ortamında da CSP kurallarına eklenirse, tarayıcı `'unsafe-inline'` iznini kapatır ve tüm Vite betikleri CSP ihlali fırlatarak çalışmaz hale gelir.

### Çözüm: Koşullu Hash Enjeksiyonu

Yerel geliştirme ortamının kusursuz çalışması, üretim ortamının (production) ise maksimum düzeyde güvenli kalması için `hashes` dizisi production koşuluna bağlanmıştır:

```ts
const hashes = config.isProduction
  ? [
      sha256("window.dataLayer=window.dataLayer||[];"),
      sha256(buildEventQueueScript()),
      sha256(EARLY_TRACKING_SCRIPT),
    ]
  : [];
```

Geliştirme ortamında hash listesi boş bırakılarak tarayıcının `'unsafe-inline'` iznine saygı duyması sağlanır. Ayrıca, Vite geliştirme sunucusunun originleri (`http://localhost:5174`) ve WebSocket HMR bağlantısı (`ws://localhost:5174`) CSP allowlist'ine eklenmiştir. Production modunda ise bu bypass'lar kapatılarak sadece hash'ler ve güvenli domainler bırakılır.

---

## 3. Operasyonel Esneklik: Enforce vs Report-Only

Yüksek trafikli kurumsal platformlarda yeni bir CSP kuralını doğrudan canlıya almak (enforced CSP) büyük bir risktir; üçüncü parti bir kütüphane veya analitik aracı engellenerek iş kaybına yol açabilir.

Mimaride bu geçişi esnek kılmak için iki çevre değişkeni (env) entegre edilmiştir:

1. `CSP_ENFORCE` (boolean): `true` ise CSP doğrudan engelleme modunda (`Content-Security-Policy`) çalışır. `false` ise sadece raporlama modundadır (`Content-Security-Policy-Report-Only`).
2. `CSP_REPORT_URI` (string): Tarayıcıların CSP ihlal raporlarını göndereceği raporlama uç noktası (örn. Sentry, Datadog veya şirket içi log collector).

Hono'un `secureHeaders` middleware'i bu konfigürasyonu startup sırasında derleyerek sıfır runtime maliyetle doğru başlığı hazırlar:

```ts
export const securityMiddleware = secureHeaders({
  xContentTypeOptions: "nosniff",
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: {
    camera: [],
    microphone: [],
    geolocation: [],
  },
  ...(config.cspEnforce
    ? { contentSecurityPolicy: cspDirectives }
    : { contentSecurityPolicyReportOnly: cspDirectives }),
});
```

---

## 4. Gözlemlenebilirlik (Observability) Metriklerinin Doğruluğu

Observability metriklerinin doğruluğu, yüksek trafik altında doğru alarm kurallarını (SLO/Alerting contracts) çalıştırmak için hayati önem taşır.

### Cardinality Kontrolü ve Route Şablonları
Gelen isteklerin metrikleri (`ssr_http_requests_total`) toplanırken `/blogs/paginated?page=2` veya `/ihtiyac-kredisi/istanbul` gibi rotalar direkt olarak metrik etiketine (label) yazılırsa, sonsuz sayıda farklı etiket değeri (cardinality explosion) oluşur ve Prometheus sunucusunu kilitleyebilir. 
Düzeltilen semantikte, Hono context'ine yazılan `requestRoute` şablonları (örn. `/blogs/paginated`, `/ihtiyac-kredisi/:city?`) metrik etiketine basılmıştır.

### Gateway Hatalarında Gerçek Timeout vs İstemci Abort Ayrımı
Gateway istekleri (`gatewayFetch`) sırasında istemciler tarayıcı sekmesini kapatabilir veya sayfadan ayrılabilir. Bu durum Node.js tarafında `AbortError` fırlatılmasına neden olur.

Eski kodda hem gerçek gateway timeout'ları hem de istemci kaynaklı iptaller tek bir `isTimeout` kontrolü ile `"timeout"` metriği olarak sınıflandırılıyordu. Bu durum, gateway sağlıklı olsa bile kullanıcıların sayfadan ayrılma sıklığına göre yanlış gateway alarmları (false positive) tetikliyordu.

Düzeltilen yapıda, fetch composite abort signal'inin hangi kaynaktan kesildiği tespit edilmiştir:

```typescript
} catch (error) {
  // Sadece internal timeout sinyali tetiklenmişse gerçek timeout'tur
  const outcome = timeout.aborted ? "timeout" : "network_error";
  span.setAttribute("gateway.outcome", outcome);
  observeGatewayRequest(0, performance.now() - started, outcome);
  throw error;
}
```

Bu ayrım, gateway alarmlarının sadece sistem kaynaklı gerçek tıkanıklıklarda tetiklenmesini garanti altına alır.

---

## Sonuç

Hono tabanlı SSR kit mimarimizde güvenlik ve gözlemlenebilirlik optimizasyonları şu prensiplerle hayata geçirilmiştir:

- **Sıfır İstek-Anı Maliyeti**: CSP hash'leri ve Permissions-Policy kuralları startup anında derlenerek istek başına CPU harcanması engellenmiştir.
- **Kusursuz Dev Modu & Katı Üretim Güvenliği**: Vite dev sunucusu ve React Refresh ile uyumlu bypass mekanizması, production ortamının katı güvenliğini bozmadan yerel geliştirmeyi kolaylaştırmıştır.
- **Dinamik Operasyon Kontrolü**: CSP enforce/report modu ve log endpoint'i kod yayılımı gerektirmeden env ile yönetilebilir hale getirilmiştir.
- **Temiz Telemetry Kontratı**: Doğru etiketleme ve istemci-iptal ayrımıyla cardinality patlamaları engellenmiş ve alarm hassasiyeti maksimuma çıkarılmıştır.

---

## Kaynaklar

- [Hono Secure Headers Middleware](https://hono.dev/docs/middleware/builtin/secure-headers)
- [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [React 19 Hydration Invariants](https://react.dev/link/hydration-mismatch)
- [Cache Bir Optimizasyon Değil, Route Kontratıdır](./03-cache-bir-optimizasyon-degil-route-kontratidir.md)
