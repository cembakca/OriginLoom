# SBOM ve Dependency-Track

Bu proje dependency envanterini CycloneDX SBOM olarak üretir, Dependency-Track'e yükler, sunucudaki
asenkron analizin bitmesini bekler ve bastırılmamış bulgu/politika ihlallerine göre CI kapısı uygular.

Desteklenen package manager'lar: **pnpm**, **npm**, **Yarn Berry (>=3)**. `origin-sbom` lockfile'ı
otomatik algılar; `--pm pnpm|npm|yarn` ile geçici override yapılabilir. Yarn Classic (v1) desteklenmez.

## Ne üretiliyor?

| Komut                                              | Çıktı                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm run sbom` / `npm run sbom` / `yarn run sbom` | `artifacts/sbom/bom.cdx.json` — full envanter                            |
| `... sbom:prod`                                    | `artifacts/sbom/bom.production.cdx.json` — yalnız runtime bağımlılıkları |

Her iki script de `@originloom/tooling` içindeki `origin-sbom` CLI'sini çağırır:

| PM   | Üretici                                     |
| ---- | ------------------------------------------- |
| pnpm | Yerleşik `pnpm sbom` (CycloneDX 1.6)        |
| npm  | `@cyclonedx/cyclonedx-npm` (lockfile-only)  |
| yarn | `yarn dlx @cyclonedx/yarn-plugin-cyclonedx` |

Çıktı CycloneDX 1.6 JSON'dur. Dependency-Track 4.14 ve 5.x ile uyumluluk için 1.6 sabitlenmiştir.
SBOM lockfile'dan üretilir; ilgili lockfile commitlenmeli ve CI kurulumu frozen/immutable modda
çalışmalıdır (`pnpm install --frozen-lockfile`, `npm ci`, `yarn install --immutable`).

Full SBOM build/test araçlarını da görünür kılar. Production SBOM çalışma zamanı saldırı yüzeyini
ayırmak için yararlıdır; varsayılan Dependency-Track upload'ı full SBOM'u kullanır. Kurum politikanız
yalnız runtime bileşenlerini izliyorsa `dependency-track.config.json` içindeki `bomPath` değerini
production dosyasına çevirin ve CI'da önce `sbom:prod` çalıştırın.

## Production audit

```bash
pnpm run audit:prod   # veya npm run audit:prod / yarn run audit:prod
```

`origin-audit` komutu package manager'a göre `--prod` / `--omit=dev` eşdeğerini çalıştırır.

## Dependency-Track ilk kurulum

Docker stack'inde UI ve API farklı portlardan yayımlanabilir. `DEPENDENCY_TRACK_URL`, browser'da
açtığınız UI adresi değil API server'ın dışarı açılan adresidir ve `/api` ile bitmelidir. Örnek:

```bash
export DEPENDENCY_TRACK_URL=http://127.0.0.1:8080/api
curl "$DEPENDENCY_TRACK_URL/version" # JSON içinde Dependency-Track version dönmeli
```

Araç `/api` ekini yazmazsanız kendisi ekler. Docker Compose port mapping'iniz farklıysa kendi API
portuzu kullanın. HTTPS ortamında sertifikayı Node'un güven deposuna ekleyin; TLS doğrulamasını
kapatmayın.

Dependency-Track UI'da **Administration → Access Management → Teams** altında yalnız CI için bir
team/API key oluşturun. `autoCreate: true` ve güvenlik kapısı için team'e şu izinler gerekir:

- `BOM_UPLOAD`
- `PROJECT_CREATION_UPLOAD` (proje ilk upload'da oluşturulacaksa)
- `VIEW_PORTFOLIO`
- `VIEW_VULNERABILITY`
- `VIEW_POLICY_VIOLATION`

API key'i repository'ye veya `.env.*` dosyalarına yazmayın. Lokal ilk prova:

```bash
pnpm run sbom   # veya npm/yarn eşdeğeri

export DEPENDENCY_TRACK_URL=http://127.0.0.1:8080/api
export DEPENDENCY_TRACK_API_KEY='dependency-track-team-api-key'
pnpm run dependency-track:publish
```

`publish` şu sırayı tek komutta tamamlar:

1. SBOM'un temel CycloneDX yapısını lokal doğrular.
2. Multipart upload ile proje adı/sürümü ve SBOM'u `/api/v1/bom` endpoint'ine gönderir.
3. Dönen event token'ını izleyip BOM importu, vulnerability analysis ve policy evaluation zincirini
   bekler; timeout olursa başarılı saymaz.
4. Projeyi ad+sürüm ile bulur.
5. Bastırılmış bulguları hariç tutarak finding ve policy violation sonuçlarını okur.
6. Eşik aşılırsa non-zero exit code döndürür.

Yalnız mevcut sonucu yeniden kontrol etmek için:

```bash
pnpm run dependency-track:gate
```

## Proje kimliği ve sürümleme

`dependency-track.config.json` proje adını taşır. Proje sürümü varsayılan olarak `package.json`
`version` alanıdır. Her production release'inde uygulama sürümünü artırın; aynı sürüme yapılan yeni
upload o Dependency-Track proje sürümünün envanterini günceller. Geçici bir CI sürümü gerektiğinde:

```bash
DEPENDENCY_TRACK_PROJECT_VERSION="$GIT_SHA" pnpm run dependency-track:publish
```

Bu değişkeni her main commit'inde kullanmak çok sayıda proje sürümü yaratır. Normal akışta semver
release sürümünü, özel preview ortamlarında commit SHA'yı kullanın. Aşağıdaki env override'ları
desteklenir:

| Değişken                                    | Amaç                                                              |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `DEPENDENCY_TRACK_URL`                      | Dependency-Track API base URL; zorunlu                            |
| `DEPENDENCY_TRACK_API_KEY`                  | Team API key; zorunlu ve secret                                   |
| `DEPENDENCY_TRACK_PROJECT_NAME`             | Config/package adını geçici olarak override eder                  |
| `DEPENDENCY_TRACK_PROJECT_VERSION`          | Config/package sürümünü geçici olarak override eder               |
| `DEPENDENCY_TRACK_BOM_PATH`                 | Upload edilecek SBOM'u değiştirir                                 |
| `DEPENDENCY_TRACK_CONFIG`                   | Config dosyasının yolunu değiştirir                               |
| `DEPENDENCY_TRACK_TIMEOUT_SECONDS`          | Analiz bekleme timeout'unu değiştirir                             |
| `DEPENDENCY_TRACK_POLL_INTERVAL_SECONDS`    | Event polling aralığını değiştirir                                |
| `DEPENDENCY_TRACK_FAIL_ON_SEVERITY`         | `critical`, `high`, `medium`, `low`, `info`, `unassigned`, `none` |
| `DEPENDENCY_TRACK_FAIL_ON_POLICY_VIOLATION` | `fail`, `warn`, `info`, `none`                                    |

Varsayılan kapı bastırılmamış `critical` bulguda veya `FAIL` seviyeli politika ihlalinde kapanır.
`none` ilgili kapıyı kapatır. Kalıcı eşikleri `dependency-track.config.json` içinde değiştirin; env
değişkenlerini yalnız kontrollü geçici override için kullanın.

## GitHub Actions

`.github/workflows/dependency-track.yml` her PR'da SBOM üretip 30 günlük workflow artifact'i olarak
saklar. Fork/PR bağlamına Dependency-Track key'i verilmez. Main/tag push'unda upload'ı açmak için:

1. Repository variable `DEPENDENCY_TRACK_URL` ekleyin.
2. Repository secret `DEPENDENCY_TRACK_API_KEY` ekleyin.
3. Gerekirse protected environment ve required reviewer kullanın.
4. İlk çalıştırmada `Dependency inventory` workflow sonucunu ve Dependency-Track projesini kontrol
   edin.

Workflow, scaffold sırasında seçilen package manager'a göre kurulum ve `run sbom` komutlarını
üretir. SBOM adımı her zaman `origin-sbom` script'ini çağırır.

URL variable'ı tanımlı değilse workflow SBOM artifact'ini üretir fakat dış sisteme upload etmez. URL
tanımlı, key eksik/geçersiz veya izinler yetersizse upload adımı açık hata ile kapanır.

## Vulnerability yönetim akışı

1. Yeni bulguyu component, severity, exploitability ve uygulamadaki kullanımına göre inceleyin.
2. Çözüm varsa doğrudan/transitive dependency'yi yükseltin; lockfile'ı güncelleyin.
3. Çözüm yoksa Dependency-Track analysis kaydında owner, gerekçe ve gözden geçirme tarihi tutun.
4. False-positive/accepted-risk kararını yalnız onaylı süreçle suppress edin. Kapı suppressed
   kayıtları dışarıda bırakır; silmek yerine audit izi korunur.
5. `sbom` + `dependency-track:publish` ile yeni envanteri yükleyin. Dependency-Track aynı component
   projede kaldığı sürece analysis kararlarını korur.

SBOM üretimi tek başına vulnerability bulmaz. Feed mirroring/analyzer sağlığı, policy tanımları,
notification kuralları, triage sahipliği ve Dependency-Track yedekleme/upgrade süreci sunucu
operasyonunun sorumluluğundadır. CI kapısı bu merkezi kararları uygular; onların yerine geçmez.

## Sorun giderme

- `404 /api/v1/bom`: Genellikle UI portu verilmiştir; API server portunu ve `/api` yolunu kontrol
  edin.
- `401/403`: API key'in bağlı olduğu team izinlerini ve project access control'u kontrol edin.
- `project could not be found`: `autoCreate` kapalıdır veya `PROJECT_CREATION_UPLOAD` eksiktir.
- `invalid BOM`: `sbom` komutunu yeniden çalıştırın; lockfile'ın güncel/commitli olduğunu ve config'in
  `bomPath` değerini kontrol edin.
- Yarn Classic: `origin-sbom` ve doctor Yarn Berry'ye geçiş önerir; SBOM için Berry veya npm/pnpm
  kullanın.
- Timeout: Dependency-Track worker/queue ve vulnerability feed durumunu inceleyin; timeout'u artırmak
  yalnız gerçekten yavaş analizlerde uygulanmalıdır.
- Kapı beklenmedik kapanıyorsa suppression yerine önce `dependency-track:gate` özetini ve UI'daki
  bastırılmamış bulgu/politika ihlallerini karşılaştırın.
