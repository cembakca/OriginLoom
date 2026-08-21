# Cache performans kabul paketi

`pnpm cache:acceptance` memory-only cache kontratını gerçek Node process'inde doğrular: cold ve stale
burst coalescing, negative cache, stale-if-error ve byte-weighted eviction. Redis kurulumu gerekmez.

Redis kullanılacak ortamda aynı uygulama koduyla dağıtık matrisi çalıştırın:

```bash
REDIS_URL=redis://127.0.0.1:6379 pnpm cache:acceptance:redis
```

Bu profil iki process arasında cold fill, revalidation, L2 promotion ve pub/sub invalidation'ı; ayrıca
optional/required Redis degradation davranışını sınar. Raporlar `load-test/reports/` altına yazılır.

`pnpm performance:gate`, cache doğruluk matrisi geçmeden kapasite ölçümünü başlatmaz. Varsayılan
capacity profili `Accept-Encoding: identity` kullanır. Gzip/ingress sonucu ayrı bir ölçüm evrenidir:

```bash
pnpm capacity:gzip -- --baseline performance-baseline.gzip.json
```

Identity ve gzip raporları karşılaştırılabilir kabul edilmez ve aynı baseline dosyasını paylaşmamalıdır.
