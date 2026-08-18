# Supply chain — OriginLoom platform monorepo

Bu belge, **OriginLoom geliştirme reposu** için SBOM, Dependency-Track ve release gate
adımlarını tanımlar. Ürün uygulamaları (create-app scaffold) için
[supply-chain-security.md](../packages/origin-tooling/bin/create-app/assets/docs/supply-chain-security.md)
şablonunu kullanın.

Platform geliştirme **pnpm** ile yürür; npm/yarn desteği ürün repo'ları içindir.

## Ne üretiliyor?

| Komut | Çıktı |
| ----- | ----- |
| `pnpm run sbom` | `artifacts/sbom/bom.cdx.json` — workspace aggregate (CycloneDX 1.6) |
| `pnpm run sbom:prod` | `artifacts/sbom/bom.production.cdx.json` — yalnız production bağımlılıkları |
| `pnpm run sbom:packages` | `artifacts/sbom/packages/*.cdx.json` — her `@originloom/*` paketi için ayrı BOM |

SBOM üretimi lockfile'dan yapılır; `pnpm-lock.yaml` commitli olmalıdır.

## Dependency-Track

Kök [dependency-track.config.json](../dependency-track.config.json) workspace projesini tanımlar.

Lokal prova:

```bash
pnpm run sbom

export DEPENDENCY_TRACK_URL=http://127.0.0.1:8080/api
export DEPENDENCY_TRACK_API_KEY='dependency-track-team-api-key'
pnpm run dependency-track:publish
```

CI: [.github/workflows/dependency-track.yml](../.github/workflows/dependency-track.yml)

- Her PR/push: SBOM artifact (30 gün)
- Main/tag + `DEPENDENCY_TRACK_URL` variable: upload + gate
- PR'lara API key verilmez

## Release gate bağlantısı

[production-security.md](./production-security.md) maddesi 1–2 ile uyum:

1. `pnpm ci`, `pnpm audit:prod`, Trivy, CodeQL (mevcut [ci.yml](../.github/workflows/ci.yml))
2. Release adayında `pnpm run sbom` + `pnpm run sbom:packages` çıktıları release kaydına eklenir
3. Dependency-Track URL yapılandırıldıysa `pnpm run dependency-track:publish` main/tag'de kapı uygular

[releasing.md](./releasing.md) içindeki `release:verify` rehearsal, scaffold edilen uygulamada
`pnpm run sbom` smoke adımını da çalıştırır.

## Ürün uygulamaları (npm / yarn / pnpm)

`origin-create-app --package-manager npm|yarn|pnpm` ile üretilen repo'lar:

- `origin-sbom` — lockfile algılar (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`)
- `origin-audit` — production audit komutunu PM'e göre çalıştırır
- CI workflow'ları render-time PM'e göre üretilir

Yarn Classic (v1) resmi olarak desteklenmez; Yarn Berry (>=3) gerekir.
