# Platform geliştirici rehberi

Bu belge **OriginLoom monorepo'sunda platform paketlerine** (`@originloom/*`) katkı yapan ekip
içindir. Ürün ekiplerinin registry'den kurduğu uygulamalar ve `origin-create-app` tüketici akışı
için [new-product-app.md](./new-product-app.md) ve [template-changes.md](./template-changes.md)
belgelerine bakın.

---

## Repo rolleri

| Bölüm                              | Kim kullanır              | Amaç                                                |
| ---------------------------------- | ------------------------- | --------------------------------------------------- |
| `packages/origin-shared`           | Platform                  | Framework-nötr kontratlar, routing engine, metadata |
| `packages/origin-core`             | Platform                  | Hono SSR runtime, cache, middleware — **React yok** |
| `packages/origin-react`            | Platform                  | React adaptörü, island runtime, Vite preset         |
| `packages/origin-tooling`          | Platform + tüketici (bin) | `origin-dev`, `origin-create-app`, doctor, migrate  |
| `apps/showroom`                    | Platform (referans)       | Paketlerin nasıl kullanılacağını gösteren demo ürün |
| `bin/create-app/` (tooling içinde) | Platform                  | Tüketici ekiplerin alacağı **şablon**               |

**Showroom ≠ şablon.** Showroom finans domain referansıdır; tüketici repoları `create-app` ile
oluşur. Showroom'a özgü kod şablona otomatik taşınmaz ([create-app-gap.md](./create-app-gap.md)).

---

## Değişiklik nereye gider?

Karar ağacı:

```text
Davranış tüm ürünlerde aynı mı ve platform sorumluluğu mu?
  ├─ Evet → packages/origin-* (shared / core / react / tooling)
  │         └─ Tüketicinin görmesi gereken örnek var mı?
  │              ├─ Evet → create-app şablonu (+ gerekirse showroom referans route)
  │              └─ Hayır → yalnız paket + migration belgesi
  └─ Hayır → ürün reposu (veya showroom'da yalnızca referans demo)
```

| Değişiklik türü                                                | Hedef                                |
| -------------------------------------------------------------- | ------------------------------------ |
| Cache, middleware, SSR pipeline, güvenlik                      | `@originloom/core`                   |
| Route/Ctx tipleri, routing engine, `OriginRenderer`            | `@originloom/shared`                 |
| Island, document render, Vite preset                           | `@originloom/react`                  |
| CLI, scaffold, migrate, doctor                                 | `@originloom/tooling`                |
| Yeni tüketici özelliği örneği (gateway fetch, defer island, …) | `create-app` şablonu                 |
| Finans domain demo, ek showroom route                          | `apps/showroom` (opsiyonel referans) |
| Ürün URL'leri, GTM, banka profili                              | **Şablona taşınmaz** — ürün reposu   |

Platform kodu **asla** showroom veya ürün modüllerini import etmez. Ürün kontratı `OriginRuntime`
ile enjekte edilir ([ARCHITECTURE.md](../ARCHITECTURE.md#runtime-injection-kontratı)).

---

## Katman kuralları

Bağımlılık yönü tek yönlüdür:

```text
create-app çıktısı / showroom
  → @originloom/core, @originloom/react
    → @originloom/shared
```

Yasaklar (otomatik denetlenir):

| Kenar                                                         | Neden                                   |
| ------------------------------------------------------------- | --------------------------------------- |
| `core` ↔ `react`                                              | UI framework sunucu runtime'a sızmamalı |
| `shared` → `core` / `react`                                   | Taban katman yukarı bağımlı olamaz      |
| `core` / `shared` → `react`, `react-dom`, `@originloom/react` | Framework guard — type-only dahil       |

Denetim:

```bash
pnpm check:cycles          # kök — showroom üzerinden paketleri de tarar
pnpm --filter showroom check:cycles
```

Kaynak: `packages/origin-tooling/bin/check-import-cycles.mjs`

Showroom uygulama sınırları (server ↔ islands, features ↔ islands) ESLint `import-x/no-restricted-paths`
ile ayrıca korunur (`eslint.config.js`).

---

## Dual export modeli

Workspace geliştirmede paketler **kaynak `.ts`** export eder; registry'de yayınlanan tarball **`dist/`**
içerir.

| Ortam                             | Çözümleme                                 | Kim görür            |
| --------------------------------- | ----------------------------------------- | -------------------- |
| Monorepo `pnpm dev` / `pnpm test` | `package.json` → `exports` → `./src/*.ts` | Platform geliştirici |
| `pnpm publish` / Nexus tüketicisi | `publishConfig.exports` → `./dist/*.js`   | Ürün ekipleri        |

`@originloom/tooling` yalnızca bin dosyaları yayınlar (`files: ["bin"]`); `prepack` ile `dist`
üretimi yoktur.

### Yayın öncesi derleme

`shared`, `core`, `react` paketlerinde:

```bash
pnpm run build:packages    # kök — üç paketi tsc ile derler
# veya paket dizininde:
pnpm run build             # tsc -p tsconfig.build.json
pnpm run prepack           # publish sırasında otomatik build
```

**Workspace'te `pnpm ci` geçmesi published artefaktı kanıtlamaz.** Registry tüketicisi simülasyonu:

```bash
pnpm release:verify
```

---

## Yeni public export ekleme

Örnek: `@originloom/core` altına `./my-feature` eklemek.

### 1. Geliştirme haritası (`exports`)

`packages/origin-core/package.json`:

```jsonc
"exports": {
  "./my-feature": "./src/my-feature/index.ts",
  // ...
}
```

Wildcard `"./*": "./src/*.ts"` çoğu tek dosya modülünü zaten kapsar; barrel (`index.ts`) veya
özel alt yol gerekiyorsa explicit entry ekleyin.

### 2. Yayın haritası (`publishConfig.exports`)

Aynı subpath için `dist` hedefi — **dev ve publish haritaları senkron kalmalı**:

```jsonc
"publishConfig": {
  "exports": {
    "./my-feature": {
      "types": "./dist/my-feature/index.d.ts",
      "default": "./dist/my-feature/index.js"
    }
  }
}
```

`public-api.test.ts` blocked (`null`) subpath'lerin iki haritada aynı olduğunu doğrular.

### 3. Internal kalacaksa `null` kullanın

Pipeline iç modülleri dışarı açılmamalı:

```jsonc
"./ssr/*": null,
"./middleware/pipeline": null
```

Node en spesifik `exports` eşleşmesini seçtiği için wildcard durur; `null` hedefi o subpath'i
kapatır. Kapatılan bir yolu dışarıdan import etmek **major breaking** sayılır — 1.0.0 öncesi
yüzeyi daraltmak daha kolaydır.

### 4. Test ve dokümantasyon

- [ ] `packages/origin-core/tests/public-api.test.ts` (core için) yeşil
- [ ] Paket `README.md` export tablosu güncellendi
- [ ] Tüketici örneği gerekiyorsa `create-app` şablonu güncellendi
- [ ] Breaking ise `docs/migrations/<sürüm>.md` + changeset

### 5. Doğrulama

```bash
pnpm run typecheck
pnpm run check:cycles
pnpm run test
pnpm release:verify
```

---

## Export yüzeyi envanteri (1.0.0 öncesi)

Dondurulmuş Tier 1 listesi, blocked internal yollar ve semver kuralları:
[export-surface.md](./export-surface.md).

Machine-readable manifest: `packages/origin-tooling/tests/export-surface.manifest.mjs`  
CI: `packages/origin-tooling/tests/export-surface.test.mjs`

Yeni public export veya şablon import'u eklerken manifest + belge + paket README güncellenir.

---

## Geliştirme komutları

| Komut                             | Kapsam                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dev`                        | Showroom dev stack (referans)                                                              |
| `pnpm test`                       | Tüm vitest projeleri                                                                       |
| `pnpm ci`                         | typecheck + cycles + lint + format + coverage + build + smoke                              |
| `pnpm check:cycles`               | Katman + döngü (showroom üzerinden)                                                        |
| `pnpm build:packages`             | shared, core, react → `dist/`                                                              |
| `pnpm release:verify`             | Verdaccio publish + create-app + tüketici `pnpm ci`                                        |
| `pnpm upgrade:verify`             | N-1 scaffold → migrate → güncel paketler                                                   |
| `pnpm create-app foo --workspace` | Monorepo içi pilot app                                                                     |
| `pnpm run sbom`                   | Platform workspace CycloneDX SBOM ([supply-chain-platform.md](./supply-chain-platform.md)) |

Platform paketini değiştirip tüketici etkisini görmek için `--workspace` ile oluşturulmuş pilot app
veya `release:verify` kullanın — yalnız showroom yeşil kalması yetmez.

### Supply chain ve multi-PM

- Platform monorepo **pnpm** kalır; SBOM/DT: [supply-chain-platform.md](./supply-chain-platform.md)
- Tüketici scaffold: `origin-create-app --package-manager pnpm|npm|yarn`
- CLI testleri: `packages/origin-tooling/tests/sbom-cli.test.mjs`, `dependency-track-cli.test.mjs`
- `origin-sbom` / `origin-audit` değişikliklerinde PM fixture'larını güncelleyin

---

## Eklenti mi, platform primitive mi?

> **Yeni create-app eklentisi donduruldu** (0.7.11). Varsayılan: platform primitive veya rehber.
> `--with-*` yalnızca `with-ops` ve gelecekte onaylanmış istisnalar.

| Soru                                            | Evet →                                   | Hayır →               |
| ----------------------------------------------- | ---------------------------------------- | --------------------- |
| İki ürün aynı güvenlik/cache hatasını yapar mı? | `@originloom/core` primitive             | Eklenti veya rehber   |
| Opt-in mi, her app'te gerekli mi?               | Onaylı create-app eklentisi (`--with-*`) | Base template         |
| Upgrade app-owned kod mu?                       | Eklenti + migration belgesi              | Platform paket semver |

Detay: [plugin-mechanism.md](./plugin-mechanism.md).

---

## PR checklist (platform)

### Her platform PR

- [ ] Değişiklik doğru pakette (yukarıdaki karar ağacı)
- [ ] `pnpm ci` yeşil
- [ ] Katman ihlali yok (`pnpm check:cycles`)
- [ ] Export değiştiyse `publishConfig.exports` senkron
- [ ] Breaking / migration gerekiyorsa `docs/migrations/` + changeset

### Tüketiciyi etkileyen davranış

- [ ] `create-app` şablonu ve `create-app-templates.test.mjs` güncellendi
- [ ] `pnpm release:verify` yeşil
- [ ] Gerekirse `docs/compatibility.md` matrix satırı
- [ ] Sürüm bump PR'ında [upgrading-platform.md](./upgrading-platform.md) checklist (yerel `upgrade:verify`)

### Yalnız showroom referansı

- [ ] Platform API'sine yeni public export **eklenmedi** (veya bilinçli eklendi)
- [ ] Showroom'a özgü domain kodu core'a sızmıyor (`defineGatewayContract` vb. app-side)

---

## Sık hatalar

| Belirti                                       | Olası neden                                                      |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Workspace'te çalışıyor, registry'de kırılıyor | `publishConfig.exports` eksik/yanlış; `release:verify` koşulmadı |
| `Import cycle detected`                       | Paketler arası ters import veya shared → core                    |
| `Framework boundary violation`                | `core` veya `shared` içinde React import                         |
| Ürün ekibi özelliği bulamıyor                 | Örnek yalnız showroom'da; şablona taşınmadı                      |
| Generated app lint/import hatası              | `templates.mjs` string — şablon testi güncellenmedi              |

---

## İlgili belgeler

| Belge                                            | Konu                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| [ARCHITECTURE.md](../ARCHITECTURE.md)            | Mimari kararlar, pipeline, cache                                  |
| [template-changes.md](./template-changes.md)     | Şablon PR checklist                                               |
| [releasing.md](./releasing.md)                   | Sürümleme, `release-verify`, Nexus                                |
| [compatibility.md](./compatibility.md)           | Template ↔ platform uyumluluk matrix                              |
| [upgrading-platform.md](./upgrading-platform.md) | Platform upgrade, migration, yerel registry provası               |
| [plugin-mechanism.md](./plugin-mechanism.md)     | Create-app eklenti sözleşmesi (`with-ops`; genişletme donduruldu) |
| [mock-gateway.md](./mock-gateway.md)             | Showroom vs üretilen app fixture konumları                        |
| [conventions.md](./conventions.md)               | Route, cache, island kuralları                                    |
| [create-app-gap.md](./create-app-gap.md)         | Showroom ↔ şablon fark envanteri                                  |

Paket export tabloları: `packages/origin-*/README.md`.
