# Create-app plugins (dondurulmuş)

Bu klasör `origin-create-app` opt-in eklenti yükleyicisini taşır. **Yeni eklenti geliştirmesi
planlanmıyor** — mekanizma gelecekteki ihtiyaçlar (ör. yeniden ele alınmış i18n, ürün ekibi
talebi) için hazır tutuluyor.

## Kayıtlı eklenti

| id | CLI | Amaç |
| -- | --- | ---- |
| `with-ops` | `--with-ops` | Compose, k8s, load/stress, pentest readiness |

Başka `--with-*` bayrağı yok; bilinmeyen bayrak CLI tarafından reddedilir.

## Yeni eklenti ne zaman?

1. Somut ürün/platform kararı (issue veya RFC)
2. [plugin-mechanism.md](../../../../../docs/plugin-mechanism.md) sözleşmesi
3. `registry.mjs` kaydı + `create-app-plugins.test.mjs` + [template-changes.md](../../../../../docs/template-changes.md) checklist

Varsayılan tercih: **platform primitive** veya **rehber**; eklenti yalnızca opt-in wiring
gerektiğinde.

## Dosyalar

| Dosya | Rol |
| ----- | --- |
| `registry.mjs` | Eklenti listesi ve CLI flag eşlemesi |
| `apply.mjs` | Patch motoru ve dosya birleştirme |
| `with-ops/` | Referans implementasyon |

Sözleşme: [docs/plugin-mechanism.md](../../../../../docs/plugin-mechanism.md).
