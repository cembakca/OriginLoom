# Redirect, rewrite ve proxy

Uygulamanın çalışan örnekleri `src/routing/rules.ts` dosyasındadır. Kurallar startup sırasında
`validateRoutingRules` ile doğrulanır; ilk eşleşme kazanır ve redirect kuralları rewrite'lardan önce
çalışır.

## Davranış farkları

- **Redirect:** Tarayıcı yeni URL'ye gider. Kalıcı taşımada `308`, geçici taşımada `307` tercih edin;
  method değiştiren eski istemci davranışına özellikle ihtiyacınız varsa `301`/`302` kullanın.
- **Internal rewrite:** Tarayıcıdaki URL değişmez, route matcher destination path'i kullanır.
  `publicPath` browser-visible adres olarak kalır; cache key ve canonical kararını buna göre verin.
- **External rewrite/proxy:** İstek sunucudan açıkça tanımlanan upstream endpoint'e iletilir. Bir
  gateway catch-all kuralı eklemeyin; aksi halde mevcut ve gelecekteki tüm upstream yüzeyi yanlışlıkla
  public olabilir.
- **CMS redirect/gone:** Platform middleware'i gateway'deki `/cms/redirects?path=...` kontratını
  kullanır. Mock gateway `/legacy-catalog` için `301`, `/removed-page` için `410` örneği döndürür.

Source parametreleri (`:slug`, `:path*`) destination içinde tekrar kullanılabilir. Incoming query
parametreleri destination query'siyle birleştirilir; fragment taşınmaz. External redirect host'larını
`REDIRECT_ALLOWED_HOSTS` ile açıkça izinli hale getirin.

## Yeni kural eklerken

1. Kuralı `src/routing/rules.ts` içine en dar source pattern ile ekleyin.
2. Gateway proxy ise yalnız gereken endpoint'i açın ve host'u `GATEWAY_URL` üzerinden üretin.
3. `tests/routing-rules.test.ts` içinde status, destination, query ve `publicPath` beklentisini yazın.
4. Redirect sonrası hedefin canonical/sitemap kararını gözden geçirin ve `pnpm ci` çalıştırın.

Loader'ın içerik sonucuna göre yönlendirme yapması gerekiyorsa route loader'ından
`redirect("/hedef", 308)` döndürün. Kaldırılan içerik için uygulama route'u üretmek yerine mümkünse
CMS `gone` kuralıyla `410` döndürün.
