# OriginLoom uyumluluk matrisi

Bu tablo paket, generator ve Node uyumluluğunun insan tarafından okunabilen karşılığıdır.
Machine-readable kaynak packages/origin-tooling/bin/upgrade/compatibility.mjs dosyasıdır.

| Template | Platform fixed group | Tooling | Node      | Otomatik migration | Durum         |
| -------- | -------------------- | ------- | --------- | ------------------ | ------------- |
| 0.6.x    | 0.6.x                | 0.6.x   | >=22.19.0 | 0.5.12 ve sonrası  | Destekleniyor |
| 0.5.x    | 0.5.x                | 0.5.x   | >=22.13.0 | 0.5.12 ve sonrası  | Destekleniyor |

Kurallar:

1. shared, core, react/vanilla ve tooling aynı fixed-group sürümünde yayınlanır.
2. Template sürümü package sürümü değildir: uygulamaya kopyalanan kaynakların geçtiği son migration
   seviyesidir.
3. Patch upgrade'leri ve matrix'te açıkça ilan edilen minor geçişleri otomatik olabilir; diğer
   minor/major geçişler release belgesi gerektirir.
4. Matrix dışında kalan doğrudan sıçrama desteklenmez.
5. Her yeni satır doctor kuralı, migration belgesi ve N-1 yükseltme provasıyla birlikte eklenir.

## Compatibility değişikliği kontrol listesi

- Matrix ve machine-readable kayıt aynı PR'da güncellendi.
- Breaking/non-breaking sınıflandırması yazıldı.
- Migration id'si benzersiz ve idempotent.
- Dry-run, backup ve dirty-worktree davranışı test edildi.
- Gerçek registry'de N-1 proje oluşturulup N paketlerine yükseltildi.
- Yükseltilmiş projede doctor strict ve pnpm ci geçti.
