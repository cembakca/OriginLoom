# @originloom/tooling

OriginLoom uygulamalarının scaffold, geliştirme, build, smoke, medya üretimi ve mimari kontrol
CLI'larıdır. Generated uygulamalar paketi `devDependency` olarak kullanır ve komutları kendi
`package.json` script'leri üzerinden çalıştırır.

## Yeni React projesi oluşturma

React varsayılan renderer'dır; ayrıca `--renderer react` yazmanız gerekmez. Proje adı lowercase
kebab-case olmalıdır (`investment-web` gibi) ve hedef klasör önceden var olmamalıdır.

### 1. Published/private registry'den standalone proje

Ürün ekibinin ayrı bir repository'de kullanacağı normal akış budur:

```bash
mkdir -p ~/projects
cd ~/projects

pnpm --package=@originloom/tooling@latest dlx origin-create-app investment-web \
  --title "Investment" \
  --registry https://nexus.example.com/repository/npm-private/ \
  --with-ops

cd investment-web
git init
pnpm install
pnpm ci
pnpm dev
```

`--registry`, generated projenin içine yalnız `@originloom/*` scope'unu hedefleyen bir `.npmrc`
yazar. Registry authentication gerekiyorsa token'ı repository'ye yazmayın; kullanıcı/CI npm
config'i veya secret değişkenleri üzerinden verin.

`pnpm dev`, mock gateway ile SSR ve Vite süreçlerini birlikte başlatır. Uygulama varsayılan olarak
`http://127.0.0.1:3010`, Vite `http://127.0.0.1:5010`, metrics listener ise yalnız operasyon ağı
için `:9010` üzerinde çalışır. Gerçek entegrasyona geçerken `.env.development` içindeki
`GATEWAY_URL` değerini değiştirin.

### 2. Yerel Verdaccio'dan standalone proje

Yayımlanmamış paketleri gerçek registry tüketicisi gibi denemek için üç terminal kullanın.

Repository kökünde registry'yi açık bırakın:

```bash
pnpm registry:local
```

İkinci terminalde paketleri yayınlayın:

```bash
pnpm registry:publish
```

Repository dışında projeyi oluşturun. Üst klasördeki `.npmrc` yalnız `dlx` çağrısının tooling
paketini bulmasını sağlar; `--registry` ise yeni uygulamanın kendi `.npmrc` dosyasını üretir:

```bash
mkdir -p ~/projects/originloom-local
cd ~/projects/originloom-local
echo "@originloom:registry=http://localhost:4873" > .npmrc

pnpm --package=@originloom/tooling@latest dlx origin-create-app investment-web \
  --title "Investment" \
  --registry http://localhost:4873 \
  --with-ops

cd investment-web
git init
pnpm install
pnpm ci
pnpm dev
```

Verdaccio storage repository içindeki `.verdaccio/` altında kalır. Aynı local sürüm yeniden
publish edildiğinde local paket değiştirilir; gerçek registry release'inde bunun yerine sürüm
artırılmalıdır.

### 3. OriginLoom monorepo içinde workspace proje

Bu komut repository kökünden çalıştırılır ve uygulamayı `apps/<name>` altına, `workspace:*`
bağımlılıklarıyla yazar:

```bash
pnpm create-app knowledge-web \
  --workspace \
  --title "Knowledge"

pnpm install
pnpm --filter knowledge-web ci
pnpm --filter knowledge-web dev
```

### 4. Interactive kullanım

Ad ve başlık verilmezse CLI bunları sorar:

```bash
pnpm --package=@originloom/tooling@latest dlx origin-create-app
```

CI veya script kullanımında prompt oluşmaması için hem proje adını hem `--title` değerini verin.

## Create seçenekleri

| Flag                 | Açıklama                                                                |
| -------------------- | ----------------------------------------------------------------------- |
| `--title <text>`     | README ve metadata için görünen ürün adı                                |
| `--workspace`        | `apps/<name>` altında `workspace:*` bağımlılıklarıyla üretir            |
| `--renderer react`   | React renderer; varsayılan                                              |
| `--port <n>`         | Uygulama portu; metrics `n + 6000`, Vite varsayılanı `n + 2000`         |
| `--vite-port <n>`    | Vite dev-server portunu ayrıca belirler                                 |
| `--target-dir <dir>` | Standalone projenin yazılacağı üst klasör                               |
| `--version <range>`  | Standalone proje için `@originloom/*` semver aralığı                    |
| `--registry <url>`   | Generated `.npmrc` içindeki `@originloom` registry adresi               |
| `--with-ops`         | Compose, Kubernetes, Prometheus, load/stress ve pentest readiness (tek kayıtlı eklenti) |
| `--package-manager`  | `pnpm` (varsayılan), `npm` veya `yarn` — lockfile, CI ve Docker PM'e göre üretilir   |

`--with-ops` create-app eklenti yükleyicisi üzerinden uygulanır. **Yeni `--with-*` eklentisi
planlanmıyor** — mekanizma gelecekteki opt-in ihtiyaçlar için korunuyor. Ayrıntı:
[docs/plugin-mechanism.md](../../docs/plugin-mechanism.md).

Örnek:

```bash
origin-create-app payments-web \
  --title "Payments" \
  --target-dir ~/projects \
  --version "^1.2.0" \
  --port 3020 \
  --vite-port 5020 \
  --with-ops
```

## Generated React uygulamasında gelenler

- SSR route, loader, boundary ve cache registry örnekleri
- Hydrate/defer island, BFF session ve güvenli client API yenileme akışı
- L1/L2 cache, SWR, fragment stitching ve cache purge transport'u
- Progressive SSR, bounded SSE admission ve graceful shutdown
- Read-through/SWR endpoint-data cache'li dynamic menu ve bounded bot analytics worker
- Metadata, canonical, JSON-LD, robots.txt ve sitemap
- Static redirect, internal rewrite, explicit gateway proxy, CMS redirect ve `410 Gone`
- Responsive media/icon pipeline, CSP script sequencing, metrics, tracing ve client errors
- Unit/integration testleri, CI workflow'u ve production Dockerfile
- Auth, cache, routing, streaming, SEO, observability ve operasyon rehberleri
- Template provenance, origin-doctor ve güvenli/idempotent origin-migrate akışı

`--with-ops` ayrıca Compose/Kubernetes manifestleri, Prometheus kuralları, load/stress karşılaştırma
araçları ve `pentest:readiness` script'i üretir. Önce generated `OPERATIONS.md` içindeki image, host
ve secret placeholder'larını değiştirin.

Şablon değişikliği yaparken: [docs/template-changes.md](../../docs/template-changes.md).
Mock gateway konumları: [docs/mock-gateway.md](../../docs/mock-gateway.md).
Platform paket geliştirme: [docs/platform-contributor.md](../../docs/platform-contributor.md).

## İlk geliştirme kontrol listesi

1. Generated `README.md` ve `docs/features.md` envanterini okuyun.
2. `.env.development` ile `.env.production` değerlerini ürün ortamlarına göre düzenleyin.
3. `mock-gateway/server.mjs` kontratlarını gerçek gateway payload'larıyla eşleyin.
4. `src/routing/rules.ts`, cache registry ve sitemap girdilerini ürün URL'lerine uyarlayın.
5. Secret'ları dosyaya koymadan CI/secret manager üzerinden sağlayın.
6. `pnpm ci` ile typecheck, cycle, lint, format, test, build ve smoke kontrollerini çalıştırın.
7. `pnpm dev` ile çalışan örnek route'ları ve boundary davranışlarını gözden geçirin.

## Mevcut projeyi yükseltme

Generated .originloom/project.json dosyası template sürümünü, platform aralığını, renderer/mode
bilgisini ve uygulanmış migration kimliklerini taşır. Yeni generator eski proje kaynaklarının
üzerine yazılmaz.

Yükseltme sırası:

1. Tooling paketini hedef sürüme yükseltin.
2. pnpm origin:doctor ile fixed-group, metadata ve pending migration bulgularını okuyun.
3. pnpm origin:migrate ile dry-run planını inceleyin.
4. Temiz Git ağacında pnpm origin:migrate --apply çalıştırın.
5. pnpm install, pnpm origin:doctor --strict ve pnpm ci çalıştırın.

Migration mevcut route/component dosyalarını yeniden üretmez. Yalnız machine-owned metadata,
OriginLoom dependency grubu, güvenli script'ler ve eksik upgrade rehberini değiştirir; değiştirdiği
dosyaları .originloom/backups altında saklar. Ayrıntı generated docs/upgrading.md dosyasındadır.

Platform release provası güncel sürümden temiz proje kurar. Gerçek N-1 yükseltme provası ise iki
sürümün bulunduğu registry'ye karşı pnpm upgrade:verify ile çalışır: önce önceki tooling ile proje
oluşturur, sonra güncel fixed group'a migrate eder ve generated pnpm ci kapısını çalıştırır.

## Binaries

| Komut                   | Görevi                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `origin-create-app`     | Standalone veya workspace uygulaması üretir                                          |
| `origin-dev`            | Vite, SSR ve isteğe bağlı mock gateway'i birlikte çalıştırır                         |
| `origin-dev-local`      | Local cache/Redis geliştirme topolojisini başlatır                                   |
| `origin-build`          | Bundle, registry tabanlı route/cache özeti ve `dist/originloom-manifest.json` üretir |
| `origin-build-media`    | Image/font manifest pipeline'ını çalıştırır                                          |
| `origin-generate-icons` | SVG kaynaklarından typed React icon component'leri üretir                            |
| `origin-smoke`          | Built server'ı ve isteğe bağlı gateway'i başlatıp probe eder                         |
| `origin-check-cycles`   | Import cycle, package layering ve renderer sınırlarını denetler                      |
| `origin-run-with-env`   | Komutu `.env.<app-env>` yükleyerek çalıştırır                                        |
| `origin-run-local`      | Production bundle'ı local cache seçenekleriyle çalıştırır                            |
| `origin-start-memory`   | Uygulamayı memory cache topolojisiyle başlatır                                       |
| `origin-local-redis`    | Local Redis yardımcısını çalıştırır                                                  |
| `origin-compose-up`     | Generated Docker Compose stack'ini başlatır                                          |
| `origin-docker-clean`   | Generated local Compose kaynaklarını temizler                                        |
| `origin-doctor`         | Template, fixed-group ve migration sağlığını read-only denetler                      |
| `origin-migrate`        | Upgrade planını dry-run gösterir ve güvenli biçimde uygular                          |
| `origin-sbom`           | CycloneDX 1.6 SBOM üretir (pnpm / npm / Yarn Berry lockfile)                         |
| `origin-audit`          | Production dependency audit'ini package manager'a göre çalıştırır                    |
| `origin-dependency-track` | SBOM upload, analiz bekleme ve Dependency-Track güvenlik kapısı                    |
