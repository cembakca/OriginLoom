# Template değişiklikleri

`origin-create-app` şablonu (`packages/origin-tooling/bin/create-app/`) tüketici ekiplerin dayanılacağı
tek kaynaktır. Showroom referans uygulamasıdır; şablon değişiklikleri showroom'a otomatik yansımaz
ve tersi de geçerli değildir ([create-app-gap.md](./create-app-gap.md)).

Bu belge, şablonda değişiklik yapan platform geliştiricileri için PR checklist'idir.

---

## Hangi dosyalar şablon?

| Dosya / klasör                     | Rol                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `bin/create-app/templates.mjs`     | Ana uygulama iskeleti (route, server, package.json, CI, …)                  |
| `bin/create-app/plugins/`          | Create-app eklenti registry, patch motoru ve manifest'ler                   |
| `bin/create-app/templates-ops.mjs` | `--with-ops` deployment varlıkları (plugin `with-ops` tarafından tüketilir) |
| `bin/create-app/skills/`           | Generated app Claude Code skill'leri                                        |
| `bin/create-app/assets/docs/`      | Generated app rehberleri                                                    |
| `bin/create-app/assets/load-test/` | Kapasite ve karşılaştırma script'leri                                       |

Showroom (`apps/showroom/`) yalnızca yeni platform yeteneğinin **referans implementasyonu** olarak
kullanılır; şablona taşınacak parça bilinçli seçilir. Platform paket değişiklikleri için
[platform-contributor.md](./platform-contributor.md).

---

## PR checklist

Her şablon PR'ında aşağıdakileri doğrulayın:

### Zorunlu

- [ ] `packages/origin-tooling/tests/create-app-templates.test.mjs` güncellendi veya yeni davranış
      için test eklendi
- [ ] Şablonda yeni `@originloom/*` import varsa `export-surface.manifest.mjs` güncellendi
- [ ] `pnpm --filter @originloom/tooling test` (veya kök `pnpm test`) yeşil
- [ ] Kök `pnpm release:verify` yeşil (published artefakt + temiz scaffold provası)
- [ ] Breaking veya migration gerektiren değişikliklerde `docs/migrations/<sürüm>.md` eklendi
- [ ] `.originloom/project.json` şeması veya migration kimliği değiştiyse `origin-migrate` akışı
      güncellendi (`bin/migrate.mjs`, `bin/upgrade/`)

### Şablon içeriği değiştiyse

- [ ] Üretilen TypeScript dosyalarında `simple-import-sort` uyumu (test otomatik yakalar)
- [ ] `mock-gateway/server.mjs` kontrat değiştiyse `contracts:fixtures` ve smoke beklentileri uyumlu
- [ ] `--with-ops` YAML dosyaları geçerli (test envanterini kontrol eder)
- [ ] **Onaylı** yeni create-app eklentisi eklendiyse `plugins/<id>/manifest.mjs` + `registry.mjs` +
      `create-app-plugins.test.mjs` güncellendi (varsayılan: eklenti eklenmez)
- [ ] Generated `pnpm ci` script zinciri eksiksiz

### Dokümantasyon

- [ ] Generated `assets/docs/` veya skill'ler etkilendiyse güncellendi
- [ ] Platform kök belgeleri (README, ARCHITECTURE, conventions) yalnızca platform davranışı
      değiştiyse güncellendi — showroom'a özgü detay şablona taşınmaz
- [ ] Mock gateway konumu için [mock-gateway.md](./mock-gateway.md) referansı korundu

---

## Test katmanları

| Katman                          | Ne doğrular                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `create-app-templates.test.mjs` | `renderTemplates()` çıktısı — dosya varlığı, import sırası, ops envanteri      |
| `create-app-plugins.test.mjs`   | Eklenti kapalı/açık davranışı, patch motoru                                    |
| `export-surface.test.mjs`       | Şablon `@originloom/*` import'ları ↔ dondurulmuş manifest, blocked core yollar |
| `create-app-cli.test.mjs`       | CLI bayrakları, dizin oluşturma, workspace uyarıları                           |
| Kök `release-verify`            | Registry'den kurulum, build, smoke, E2e, bundle bütçesi                        |
| `upgrade-verify`                | N-1 scaffold → migrate → güncel `pnpm ci`                                      |

Şablon string olduğu için bu repo'nun ESLint'i `templates.mjs` içeriğine bakmaz; regresyonları
yalnız üretilen app testleri ve `release-verify` yakalar.

---

## Migration ekleme

Machine-owned dosyalar (`.originloom/project.json`, dependency aralıkları, güvenli script'ler)
`origin-migrate` ile güncellenir; route/component dosyaları yeniden üretilmez.

1. Migration kimliği ve patch'i `bin/migrate.mjs` / `bin/upgrade/` altına ekleyin
2. `docs/migrations/<sürüm>.md` ile manuel adımları belgeleyin
3. `upgrade-verify` veya en az bir dry-run `origin-migrate` ile doğrulayın

---

## `--with-ops` notu

Compose ve k8s manifestleri opt-in'dir. YAML dosyaları statik olarak test edilir; runtime doğrulama
(`pnpm compose:up`, Redis overlay) Docker olan ortamda ayrıca yapılmalıdır.

---

## İlgili belgeler

- [export-surface.md](./export-surface.md) — dondurulmuş Tier 1 export taahhüdü
- [plugin-mechanism.md](./plugin-mechanism.md) — create-app eklenti sözleşmesi
- [mock-gateway.md](./mock-gateway.md) — showroom vs üretilen app fixture konumları
- [create-app-gap.md](./create-app-gap.md) — showroom ile şablon fark envanteri
- [releasing.md](./releasing.md) — paket yayını ve `release-verify`
- [new-product-app.md](./new-product-app.md) — tüketici ekip onboarding
