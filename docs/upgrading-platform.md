# Platform upgrade ve migration (geliştirme ortamı)

Bu belge **OriginLoom monorepo'sunda platform geliştiricileri** içindir: sürüm yükseltirken migration
eklerken, yerel registry ile N-1→N provasını çalıştırırken ve Nexus'a geçmeden önce neyin yeterli
olduğunu netleştirir.

Ürün ekiplerinin (registry'den kurulu standalone repo) akışı generated `docs/upgrading.md`
içindedir. Nexus go-live ayrı adımdır — [releasing.md](./releasing.md) §5.

---

## İki farklı upgrade senaryosu

| Senaryo                  | Kim                          | Registry                                   | Araçlar                                      |
| ------------------------ | ---------------------------- | ------------------------------------------ | -------------------------------------------- |
| **Platform geliştirme**  | Bu repo                      | `workspace:*` (symlink)                    | `pnpm ci`, migration unit testleri           |
| **Tüketici simülasyonu** | Platform QA / release öncesi | Yerel Verdaccio (bugün) veya Nexus (sonra) | `release:verify`, `upgrade:verify`           |
| **Gerçek ürün reposu**   | Ürün ekibi                   | Nexus (hedef)                              | `origin:doctor`, `origin:migrate`, `pnpm ci` |

Showroom `workspace:*` kullanır; **showroom yeşil ≠ registry tüketicisi yeşil**. Platform değişikliği
tüketiciyi etkiliyorsa `release-verify` ve (sürüm atlarken) `upgrade-verify` koşulmalıdır.

---

## Semver ve fixed group (0.7.x)

Dört paket aynı sürümde yayınlanır: `@originloom/shared`, `@originloom/core`, `@originloom/react`,
`@originloom/tooling`.

| Değişiklik türü                                                      | Sürüm adımı | Örnek           |
| -------------------------------------------------------------------- | ----------- | --------------- |
| Bugfix, davranış düzeltmesi, Tier 1 API aynı                         | **Patch**   | 0.7.10 → 0.7.11 |
| Yeni Tier 1 export, yeni migration (otomatik), geriye uyumlu özellik | **Minor**   | 0.7.x → 0.8.0   |
| Tier 1 kaldırma, breaking migration, major kontrat değişikliği       | **Major**   | 0.x → 1.0.0     |

`0.x` iken minor da breaking olabilir — yine de **migration belgesi + upgrade-verify** zorunludur.

Detaylı export taahhüdü: [export-surface.md](./export-surface.md).  
Uyumluluk matrisi: [compatibility.md](./compatibility.md).

---

## Platform geliştiricisi — günlük akış

Monorepo içinde paket kaynağını değiştirdiğinizde:

```bash
pnpm install
pnpm ci                    # workspace: showroom + paket testleri
```

Migration eklediyseniz:

- [ ] `packages/origin-tooling/bin/migrate.mjs` / `bin/upgrade/` patch'i
- [ ] `docs/migrations/<hedef-sürüm>.md`
- [ ] `docs/compatibility.md` + `compatibility.mjs` (gerekirse)
- [ ] Generated şablonda machine-owned dosya değişikliği (varsa)
- [ ] `export-surface.manifest.mjs` (yeni `@originloom/*` import varsa)

Workspace pilot app (opsiyonel):

```bash
pnpm create-app pilot-web --workspace --title "Pilot"
pnpm --filter pilot-web ci
```

---

## Sürüm yükseltme — platform ekibi checklist

### 1. Hazırlık

```bash
pnpm changeset              # veya: pnpm version:set patch
pnpm changeset:version      # changeset yolunda
```

- [ ] Migration id benzersiz ve idempotent
- [ ] `docs/migrations/<sürüm>.md` yazıldı
- [ ] Schema v2: `plugins[]` alanı etkilendiyse migration + doctor kontrol edildi
- [ ] Breaking ise compatibility matrix güncellendi

### 2. Workspace doğrulama

```bash
pnpm ci
```

### 3. Registry tüketicisi doğrulama (Nexus yokken yerel Verdaccio)

**Terminal 1** — registry açık kalsın:

```bash
pnpm registry:local
```

**Terminal 2** — N-1 ve N sürümünü registry'de bulundurun:

Yerel registry aynı sürümü üzerine yazar. `upgrade-verify` için registry'de **iki farklı sürüm**
olmalıdır:

```bash
# Örnek: 0.7.9 zaten registry'deyse, sürümü 0.7.10'a yükseltip tekrar publish edin
pnpm version:set 0.7.10
pnpm registry:publish

# N-1 proje → N migrate provası
pnpm upgrade:verify --from 0.7.9 --registry http://localhost:4873
```

`--from` verilmezse script registry'deki aynı major.minor içindeki **bir önceki patch**'i seçer.

Temiz scaffold provası (güncel sürüm, migration yok):

```bash
pnpm release:verify
```

### 4. Ürün ekibi runbook'u (gelecek Nexus)

Nexus'a geçince ürün repolarında aynı sıra geçerli kalır — generated `docs/upgrading.md`:

```bash
pnpm add -D @originloom/tooling@<hedef>
pnpm update "@originloom/*" --latest   # fixed group birlikte

pnpm origin:doctor
pnpm origin:migrate
pnpm origin:migrate --apply
pnpm install
pnpm origin:doctor --strict
pnpm ci
```

Platform ekibi yeni sürümü Nexus'a publish etmeden önce yerel Verdaccio'da 3. adımı geçmiş olmalı.

---

## Üç prova — birbirinin yerine geçmez

| Prova                 | Ne kanıtlar                                      | Ne zaman                                     |
| --------------------- | ------------------------------------------------ | -------------------------------------------- |
| `pnpm ci`             | Workspace kaynak + showroom                      | Her PR                                       |
| `pnpm release:verify` | Published `dist`, create-app, tüketici `pnpm ci` | Her PR (CI)                                  |
| `pnpm upgrade:verify` | N-1 scaffold → migrate → N tüketici `pnpm ci`    | Sürüm bump PR'ları, migration değişiklikleri |

Nexus go-live sonrası `upgrade:verify` için `--registry` Nexus URL'si yeterli; akış aynı kalır.

---

## Migration yazarken

1. **Machine-owned** dosyalar: `package.json` script'leri, `.originloom/project.json`, tooling aralığı
2. **Asla otomatik overwrite edilmez**: route, component, `.env`, ürün kontratı
3. Dry-run varsayılan; `--apply` Git temiz ağacı ister (istisna: `--allow-dirty`)
4. Backup: `.originloom/backups/<from>-to-<to>/`

Şablon değişikliği checklist: [template-changes.md](./template-changes.md).

---

## Sık sorunlar

| Belirti                                       | Olası neden                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `upgrade:verify` — önceki sürüm bulunamadı    | Registry'de yalnızca tek patch var; önce N-1 publish edin veya `--from` verin |
| `pnpm store` eski tarball                     | Yerel registry'de aynı sürümü yeniden publish ettiniz; `pnpm store prune`     |
| Doctor pending migration yok ama bekleniyordu | Tooling workspace link; standalone registry projesinde deneyin                |
| Showroom geçti, release-verify kırıldı        | `publishConfig.exports` veya `dist` uyumsuz                                   |

---

## Nexus geldiğinde (son adım)

Bu belgedeki Verdaccio komutlarında yalnız URL ve token değişir:

- `pnpm registry:publish` → CI `changeset publish` + Nexus
- `upgrade:verify --registry https://nexus.../npm-group/`
- Ürün repoları `--registry` ile create-app

Go-live checklist: [releasing.md](./releasing.md) §5.

---

## İlgili belgeler

- [compatibility.md](./compatibility.md) — matrix ve semver kuralları
- [migrations/README.md](./migrations/README.md) — migration kayıt formatı
- [releasing.md](./releasing.md) — publish ve release-verify
- [export-surface.md](./export-surface.md) — Tier 1 API taahhüdü
- [plugin-mechanism.md](./plugin-mechanism.md) — create-app eklenti sözleşmesi
- [platform-contributor.md](./platform-contributor.md) — katman ve export rehberi
