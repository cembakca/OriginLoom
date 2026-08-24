# OriginLoom sürüm yükseltme

OriginLoom paketleri fixed group olarak sürümlenir. shared, core, renderer ve tooling paketlerini
tek tek yükseltmeyin; aynı sürüm aralığında tutun. Template kaynakları uygulamaya aittir ve yeni
generator çalıştırıldığında otomatik olarak üzerine yazılmaz.

## Proje metadata'sı

.originloom/project.json şu sözleşmeyi taşır:

- schemaVersion: metadata formatı (v2: `plugins[]` alanı)
- templateVersion: projenin en son geçtiği template/migration sürümü
- platformRange: generated package aralığı
- mode: standalone/workspace ayrımı
- plugins: scaffold sırasında etkin create-app eklentileri (ör. `with-ops`)
- appliedMigrations: idempotent migration kimlikleri

Bu dosyayı elle yeni sürüme çekmeyin. Değerin değişmesi migration'ın gerçekten uygulandığı anlamına
gelir.

## Her yükseltmede izlenecek sıra

1. Temiz bir branch açın; çalışma ağacını commit veya stash ile temizleyin.
2. Release notes, compatibility matrix ve hedef migration belgesini okuyun.
3. Tooling paketini hedef sürüme alın ve kurun.
4. pnpm origin:doctor çalıştırın.
5. pnpm origin:migrate ile dry-run planını inceleyin.
6. pnpm origin:migrate --apply çalıştırın.
7. package.json, .originloom/project.json ve backup diff'ini inceleyin.
8. pnpm install çalıştırın ve lockfile değişikliğini inceleyin.
9. pnpm origin:doctor --strict ve pnpm ci çalıştırın.
10. Uygulamanın kritik browser/smoke akışlarını doğruladıktan sonra değişikliği commit'leyin.

Örnek:

```bash
git switch -c chore/originloom-0-6
pnpm add -D @originloom/tooling@0.6.0

pnpm origin:doctor
pnpm origin:migrate
pnpm origin:migrate --apply
pnpm install
pnpm origin:doctor --strict
pnpm ci
```

Migration, standalone projede bütün mevcut @originloom paketlerini aynı hedef sürüme taşır.
Workspace projede workspace:* bağlarını değiştirmez.

## Güvenlik ve geri alma

origin-migrate varsayılan olarak dry-run çalışır. --apply verilse bile Git çalışma ağacı kirliyse
durur; bilinçli istisna için --allow-dirty gerekir. Değiştirdiği dosyaları
.originloom/backups/<from>-to-<to>/ altında saklar ve JSON dosyalarını atomik yazar.

Migration var olan docs/upgrading.md dosyasını ezmez. Route, loader, component, environment ve ürün
kontratları otomatik olarak yeniden üretilmez. Böyle bir breaking change varsa migration planı
manuel adımı ve ilgili release belgesini göstermelidir.

Geri almak için önce Git üzerinden branch'i geri alın. Git kullanılamıyorsa backup içindeki
package.json ve project.json dosyalarını geri koyup pnpm install çalıştırın.

## Doctor bulguları

- package-range-drift: OriginLoom paket aralıkları ayrışmış.
- installed-version-drift: node_modules içinde fixed group ayrışmış.
- lockfile-stale: package.json ve kurulu sürüm uyuşmuyor.
- metadata-missing/schema: proje eski veya metadata formatı desteklenmiyor.
- migration-pending: uygulanmamış idempotent migration var.
- tooling-too-old: proje metadata'sı çalışan tooling'den yeni.

CI, pnpm origin:doctor --strict çalıştırır; warning'ler de upgrade borcu olarak build'i durdurur.

## Destek penceresi

Otomatik migration yalnız compatibility matrix'te ilan edilen sürümden başlar. Daha eski proje
doğrudan en yeni sürüme atlatılmaz: önce desteklenen ara sürüme manuel olarak gelin, o sürümün
pnpm ci kapısını geçin, sonra sıradaki migration'ı çalıştırın.

## Şablondan ne kadar uzaktayız?

```bash
pnpm origin:doctor --drift
```

Uygulamanın bugün üretilecek hâlinden dosya başına kaç satır uzakta olduğunu, en büyükten küçüğe
listeler. Bir gate değildir ve olmamalı: sağlıklı bir uygulamanın ıraksamasının çoğu ürünün
kendisidir — route'ları, sayfaları, cache key'leri, testleri.

Aranan şey listenin tepesine yakın duran bir **altyapı** dosyasıdır. Bir yardımcı modül, bir config,
şablonun ilerlediği ama bu uygulamanın ilerlemediği bir yer. Böyle bir satır gördüğünüzde ya
migration eksiktir ya da o dosya artık platforma ait olmalıdır — ikisi de platform ekibine bir
issue'dur.
