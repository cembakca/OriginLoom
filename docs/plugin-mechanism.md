# Create-app eklenti mekanizması

> **Durum: dondurulmuş (0.7.11).** Mekanizma tamam; kayıtlı eklenti yalnızca `with-ops`.
> Yeni eklenti (i18n, arama, OIDC, …) **planlanmıyor** — somut talep gelince bu belgeye göre
> eklenir. Kod ve testler korunur; genişletme aktif roadmap değildir.

OriginLoom `origin-create-app` şablonu opt-in entegrasyonları **eklenti** olarak ekler.
Bugünkü referans: `--with-ops` (Compose, Kubernetes, load/stress, pentest readiness).

Bu belge sözleşmeyi, upgrade modelini ve (talep halinde) yeni eklenti ekleme akışını tanımlar.
Ekosistem tartışma zeminı: [ecosystem-backlog.md](./ecosystem-backlog.md).

---

## Üç entegrasyon şekli

| Şekil | Ne zaman | Örnek |
| ----- | -------- | ----- |
| **Platform primitive** | İki ürün aynı güvenlik/cache hatasını yapar | `guardWebhook`, cache purge mount |
| **Create-app eklentisi** | Opt-in wiring + üretilen app kodu | `--with-ops` |
| **Rehber** | Seçim ürüne özgü, platform taahhüdü yok | Design system bağlama |

Eklentiler **üretilen uygulamaya kod yazar** — upgrade sonrası dosyalar app-owned kalır.
Platform paketinde kalması gereken mantık eklenti değil, `@originloom/*` primitive'idir.

---

## Upgrade modeli

```text
origin-create-app --with-ops
        │
        ├─ base template (templates.mjs)
        └─ plugin files + patches (plugins/<id>/)
                │
                ▼
        generated app (owned by product team)
                │
                ▼
        origin-migrate (machine-owned metadata only)
```

- Eklenti güncellemesi otomatik gelmez; platform sürümü + migration belgesi ile ilerlenir.
- `.originloom/project.json` → `plugins: string[]` hangi eklentilerin scaffold sırasında
  etkin olduğunu kaydeder (schema v2).
- Gelecekte eklenti-farkında migration'lar bu listeyi okuyabilir.

---

## Klasör sözleşmesi

```
packages/origin-tooling/bin/create-app/plugins/
  registry.mjs           # id → manifest, CLI flag eşlemesi
  apply.mjs              # patch motoru + dosya birleştirme
  with-ops/
    manifest.mjs         # id, flags, packageJsonPatches, textPatches
    files.mjs            # ek dosya haritası (renderOpsTemplates)
```

Her eklenti `manifest.mjs` export eder:

| Alan | Zorunlu | Açıklama |
| ---- | ------- | -------- |
| `id` | evet | Benzersiz kimlik (`with-ops`) |
| `flags` | hayır | CLI bayrakları (`--with-ops`) |
| `files(ctx)` | hayır | `Record<path, string>` ek dosyalar |
| `packageJsonPatches` | hayır | `scripts` / `dependencies` merge |
| `textPatches` | hayır | Anchor tabanlı metin patch'leri |

Yeni eklenti (yalnızca onaylı talep sonrası): `plugins/<id>/manifest.mjs` ekleyin,
`registry.mjs` içinde kaydedin, test yazın — bkz. [plugins/README.md](../packages/origin-tooling/bin/create-app/plugins/README.md).

---

## Patch motoru

Base template'te sabit anchor'lar:

| Anchor | Dosya | Amaç |
| ------ | ----- | ---- |
| `// @originloom:hook middleware-exports` | `server/middleware/index.ts` | Middleware listesi |
| `// @originloom:hook package-json-scripts` | `templates.mjs` (kaynak) | Script merge referansı |
| `<!-- @originloom:hook readme-ops-table -->` | `README.md` | Ops komut tablosu |

Patch tipleri (`apply.mjs`):

| Tip | Kullanım |
| --- | -------- |
| `insertAfter` | Anchor sonrasına satır ekle |
| `insertBefore` | Anchor öncesine satır ekle |
| `replaceBlock` | Anchor'ı değiştir |
| `mergePackageJson` | `package.json` script/dependency merge |

Anchor yoksa veya çift patch varsa üretim **hata verir** (sessiz skip yok).

---

## CLI

```bash
origin-create-app payments-web --with-ops
```

Bilinmeyen `--with-*` bayrağı anlamlı hata ile reddedilir.

---

## Metadata (schema v2)

```json
{
  "schemaVersion": 2,
  "plugins": ["with-ops"],
  "templateVersion": "0.7.11",
  ...
}
```

`origin-doctor` bilinmeyen plugin id ve metadata/script drift'ini uyarır.
Migration: [migrations/0.7.11.md](./migrations/0.7.11.md).

---

## Test gereksinimleri

Her eklenti için:

1. **Kapalı:** eklenti dosyaları yok, `plugins: []`, ilgili script/import izi yok
2. **Açık:** dosya envanteri + `pnpm ci` zinciri geçer
3. Patch motoru unit testleri (`create-app-plugins.test.mjs`)

---

## Kapsam dışı (platform taahhüdü)

OriginLoom **gateway önünde SSR katmanıdır**. Doğrudan veritabanı erişimi ve `DataSource`
kontratı backlog'ta — bkz. [ecosystem-backlog.md](./ecosystem-backlog.md) §9.

---

## İlgili belgeler

- [template-changes.md](./template-changes.md) — şablon PR checklist
- [platform-contributor.md](./platform-contributor.md) — eklenti vs primitive karar ağacı
- [upgrading-platform.md](./upgrading-platform.md) — platform upgrade runbook
