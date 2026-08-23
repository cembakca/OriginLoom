# OriginLoom uyumluluk matrisi

Bu tablo paket, generator ve Node uyumluluğunun insan tarafından okunabilen karşılığıdır.
Machine-readable kaynak packages/origin-tooling/bin/upgrade/compatibility.mjs dosyasıdır.

| Template | Platform fixed group | Tooling | Node      | Otomatik migration | Durum         |
| -------- | -------------------- | ------- | --------- | ------------------ | ------------- |
| 0.7.x    | 0.7.x                | 0.7.x   | >=24.18.1 | 0.5.12 ve sonrası  | Destekleniyor |
| 0.6.x    | 0.6.x                | 0.6.x   | >=22.19.0 | 0.5.12 ve sonrası  | Destekleniyor |
| 0.5.x    | 0.5.x                | 0.5.x   | >=22.13.0 | 0.5.12 ve sonrası  | Destekleniyor |

Machine-readable kaynak: `packages/origin-tooling/bin/upgrade/compatibility.mjs` (`COMPATIBILITY` dizisi).

Platform geliştirme ve N-1→N provası (Nexus öncesi yerel Verdaccio dahil):
[upgrading-platform.md](./upgrading-platform.md).

## Semver (fixed group)

| Adım      | Ne zaman                                                      | Zorunlu ekler                                              |
| --------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| **Patch** | Bugfix, internal refactor, Tier 1 API değişmez                | Migration çoğunlukla no-op; yine de doctor/migrate test et |
| **Minor** | Yeni Tier 1 export, otomatik migration, geriye uyumlu özellik | `docs/migrations/`, `upgrade:verify` (yerel registry)      |
| **Major** | Tier 1 kaldırma, breaking kontrat                             | Migration + manuel adımlar + compatibility satırı          |

`0.x` serisinde bile breaking değişiklik migration belgesi olmadan ship edilmez.

Tier 1 export tanımı: [export-surface.md](./export-surface.md).

## Kurallar

1. shared, core, react ve tooling aynı fixed-group sürümünde yayınlanır.
2. Template sürümü package sürümü değildir: uygulamaya kopyalanan kaynakların geçtiği son migration
   seviyesidir.
3. Patch upgrade'leri ve matrix'te açıkça ilan edilen minor geçişleri otomatik olabilir; diğer
   minor/major geçişler release belgesi gerektirir.
4. Matrix dışında kalan doğrudan sıçrama desteklenmez.
5. Her yeni satır doctor kuralı, migration belgesi ve N-1 yükseltme provasıyla birlikte eklenir.

Platform geliştirici rehberi (export yüzeyi, katman kuralları): [platform-contributor.md](./platform-contributor.md).

## Compatibility değişikliği kontrol listesi

- Matrix ve machine-readable kayıt aynı PR'da güncellendi.
- Breaking/non-breaking sınıflandırması yazıldı.
- Migration id'si benzersiz ve idempotent.
- Dry-run, backup ve dirty-worktree davranışı test edildi.
- Yerel Verdaccio'da (veya Nexus'ta) N-1 proje oluşturulup N paketlerine yükseltildi (`pnpm upgrade:verify`).
- Yükseltilmiş projede doctor strict ve pnpm ci geçti.
