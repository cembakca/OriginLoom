# Dynamic menu ve shell degradation

Header/footer verisi route loader'ına değil `server/services/shell-data.ts` üzerinden
`OriginRuntime.shell` dependency planına aittir. Public snapshot route loader ile paralel başlar;
request facts, public snapshot, targeted shell ve request overlay ayrı kontratlardır.

`RequestOverlay` shared cache fill/revalidation/fragment render aşamalarına verilmez. Cookie veya
kullanıcıya özel değer yalnız no-store SSR için overlay'e girebilir; shared sayfada gerekli client
state tarayıcının kendi cookie/context'inden kurulmalıdır. `buildShellData` yalnız eski runtime'ların
geçiş uyumluluğu içindir.

Public menu cache'lenebilir olduğundan `gatewayFetch` kullanılır; çağıranın Authorization header'ı
paylaşılan isteğe taşınmaz. Response'u boyut sınırı ve runtime schema'dan geçirin; label, URL, child
sayısı ve nesting depth'i sınırlayın. Public menu'yu ayrı TTL/SWR ile cache'leyin. Key'e yalnız locale ve platform parser'ından çıkan kapalı
`mobile|tablet|desktop` değeri gibi HTML'i gerçekten değiştiren boyutlar girer; raw User-Agent girmez.

Generated örnekte menu herkese aynı olduğu için key `menu:public:v1` değeridir. Fresh hit gateway'i
atlamalı, stale hit hızlı dönüp single-flight background refresh başlatmalı, local fallback ise cache'e
yazılmamalıdır. Locale/device menu payload'ını gerçekten değiştiriyorsa yalnız normalize edilmiş bu
değerleri key'e ekleyin.

Dış URL, protocol-relative URL ve gateway hostunu public link olarak kabul etmeyin. Linkleri normalize
edip yalnız izin verilen scheme/origin'leri serialize edin. Gateway kesintisinde kişisel veri içermeyen
bounded fallback chrome döndürün ve degradation metriği üretin. Fragment render için gerekli menu
eksikse `isShellUsableForFragments` false dönsün; eksik shell'i fragment cache'e yazmayın.

Header'ın etkileşimli kısmını island yapın; navigation'ın kendisi erişilebilir SSR HTML olarak
kalmalıdır.
