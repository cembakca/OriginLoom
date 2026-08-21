# Cache purge: TTL dolmadan düzeltmek

Bir sayfa cache'lendikten sonra yanlış olduğu anlaşılırsa iki cevap kalır: beklemek ya da fleet'i
yeniden başlatmak. Purge üçüncü cevaptır.

Uçlar platformdan gelir (`@originloom/core/api/cache-purge`) ve `server/index.ts` içinde
**operations listener'ına** mount edilir — siteye değil. Sebebi tek cümle: cache'i boşaltmak tüm
fleet'i gateway'e yöneltir; bu düğme internetin ulaşabildiği bir portta durmamalı. Bunun testi var
(`tests/cache-purge.test.ts` → "is not reachable from the public site").

```bash
# Önce bak: hangi key'ler var? (operations portu, sitenin portu değil)
curl -s -H "X-Cache-Purge-Token: $CACHE_PURGE_SECRET" \
  "http://127.0.0.1:9010/api/internal/cache/keys?prefix=catalog"

# Sonra sil: registry'deki sayfa id'leriyle.
curl -s -X POST -H "X-Cache-Purge-Token: $CACHE_PURGE_SECRET" \
  -H "content-type: application/json" \
  -d '{"pageIds":["catalog","item-detail"]}' \
  http://127.0.0.1:9010/api/internal/cache/purge

# Bir kaynağa bağlı data/page/fragment entry'lerini birlikte sil.
curl -s -X POST -H "X-Cache-Purge-Token: $CACHE_PURGE_SECRET" \
  -H "content-type: application/json" \
  -d '{"tags":["resource:menu"]}' \
  http://127.0.0.1:9010/api/internal/cache/purge
```

Önce listeleme, sonra silme: bakmadığınız bir key'i silmek, tam flush'ın nasıl olduğudur.

## Korumalar

- **Token.** `CACHE_PURGE_SECRET` yoksa production'da uçlar `503` döner — açık çalışmaz. Bir
  konfigürasyon eksiği, herkese açık bir purge ucuna dönüşmemeli. Development'ta secret olmadan
  açıktır; korunacak bir şey yoktur.
- **Sabit zamanlı karşılaştırma.** Erken dönen bir karşılaştırma, secret'ı ölçüm yapan birine bayt
  bayt sızdırır.
- **`pageIds` allowlist'lidir.** `src/lib/cache-keys.ts` registry'si listedir; sayfa id'siyle purge
  yalnızca bu uygulamanın gerçekten cache'lediği bir sayfayı adlandırabilir. `prefix` ham biçimdir ve
  allowlist değil yalnızca sınırlıdır (wildcard yok, uzunluk sınırlı) — mümkün olduğunca `pageIds`
  kullanın.
- **Cevap cache'lenmez.**
- **Tag operasyonları bounded'dır.** Bir istekte en fazla 8 stabil tag ve tag başına en fazla 500
  ilişkili key işlenir. Response `truncated: true` ise aynı purge güvenle tekrarlanabilir.

Bearer da kabul edilir: `Authorization: Bearer $CACHE_PURGE_SECRET`.

## Ne zaman purge, ne zaman TTL

Purge bir istisnadır. Düzenli olarak purge ediyorsanız TTL'iniz yanlıştır — SWR ile kısa TTL,
periyodik purge'den her zaman daha iyidir. Purge'ü şunlar için saklayın: yanlış yayına çıkan içerik,
acil fiyat düzeltmesi, hatalı bir deploy sonrası temizlik.

`RELEASE_ID` değiştiğinde Redis namespace'i de değişir; yeni release zaten boş cache ile başlar.
Entry'ler, tag indeksleri ve invalidation Pub/Sub kanalı release-scoped'dur; rolling deploy sırasında
iki release birbirinin L1/L2 state'ini silmez. Subscriber bağlantı aralığından sonra geri gelirse
kaçırılmış mesaj riskine karşı local L1'i tamamen temizler. Purge esas olarak **aynı release içinde**
içerik düzeltmek içindir.
