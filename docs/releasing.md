# Paketleme ve Yayın

Bu belge `@originloom/*` paketlerinin nasıl sürümlendiğini, yayın provasının nasıl çalıştığını ve
**gerçek bir registry'ye geçerken tam olarak neyin değişmesi gerektiğini** anlatır.

Bugünkü durum tek cümleyle: paketler yayınlanabilir haldedir, yayın hattı uçtan uca prova
edilmiştir ve **yerel bir registry üzerinden ekiplerin denemesine açıktır**; henüz kurumsal bir
registry'ye yayınlanmamaktadır. Hedef: **Nexus** üzerinde private paketler (§5).

İlgili: [ARCHITECTURE.md](../ARCHITECTURE.md#workspace-platform-ve-ürün-ayrımı) (paket sınırları),
[new-product-app.md](./new-product-app.md) (bu paketleri tüketen uygulama üretmek).

---

## 1. Ne var elimizde

| Parça             | Nerede                                        | Ne yapar                                                     |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------ |
| Sürümleme         | `.changeset/config.json`                      | Paketleri tek sürümde tutar (`fixed` grup)                   |
| Yayın provası     | `scripts/release-verify.mjs`                  | Verdaccio'ya yayınlar, temiz app'e kurar, build + smoke eder |
| CI kapısı         | `.github/workflows/ci.yml` → `release-verify` | Her PR'da provayı koşar                                      |
| Public API sınırı | `packages/origin-core/package.json` `exports` | İç modülleri `null` hedefle kapatır                          |
| Yerel registry    | `scripts/local-registry.mjs`                  | Kalıcı Verdaccio — ekipler standalone akışı burada dener     |
| Kaza güvenliği    | Her paketin `publishConfig.registry`          | Elle `pnpm publish` yerel Verdaccio'ya gider, npmjs'e değil  |

### Yayınlanan paketler

`@originloom/shared`, `@originloom/core`, `@originloom/react`, `@originloom/tooling`. `apps/showroom` yayınlanmaz (changesets'te `ignore` listesinde).

---

## 2. Günlük kullanım

### Değişiklik yaptığınızda

```bash
pnpm changeset
```

Etkilenen paketi ve etki düzeyini (patch/minor/major) sorar, `.changeset/` altına bir markdown
düşürür. **Bu dosyayı PR'ınızla birlikte commit'leyin.** Hangi paketi seçtiğiniz pratikte fark
etmez: sabit grup olduğu için beşi birden yükselir — ama seçilen düzey (major/minor/patch) grubun
düzeyini belirler.

Sürüm gerektirmeyen bir değişiklik için: `pnpm changeset --empty`.

### Sürüm yükseltirken

İki yol var; **ikisini karıştırmayın**.

**A) changesets ile (kayıt tutar):**

```bash
pnpm changeset:version   # changeset version + lockfile güncelleme
```

Biriken changeset dosyalarından yeni sürümü hesaplar, beş `package.json`'ı yükseltir,
`CHANGELOG.md` dosyalarını yazar ve changeset dosyalarını siler.

**B) Elle sürüm vererek (hızlı yol):**

```bash
pnpm version:set 0.2.0        # ya da: patch | minor | major
pnpm version:set 0.3.0 --dry-run
```

Beş pakete aynı sürümü yazar. Sabit grup olduğu için hepsi birlikte hareket eder; script paketlerin
hâlihazırda aynı sürümde olduğunu da doğrular — grup bozulmuşsa durur, çünkü öyle bir yayın
tüketiciyi çözülemez bir kümeyle bırakır.

> Elle sürüm verdiyseniz **bekleyen changeset dosyalarını silin** (veya önce A yolunu çalıştırın).
> Aksi halde bir sonraki `changeset:version` aynı değişiklikleri ikinci kez sayar.

### Yükselttikten sonra: yayınla ve tüketiciye ulaştır

```bash
pnpm install --lockfile-only   # workspace linkleri yeni sürümü görsün
pnpm registry:publish          # yerel registry'ye (Nexus'ta: §5.4'teki workflow)
git commit -am "chore(release): 0.2.0"
```

Tüketici uygulamada (repo dışında, registry'den kurulu olan):

```bash
pnpm update "@originloom/*" --latest
```

`package.json`'daki aralık `^0.2.0` biçimindeyse `--latest` olmadan da minor/patch güncellemeleri
gelir; major geçişte aralığı elle yükseltmek gerekir.

**Aynı sürümü yeniden yayınlamayın.** Yerel registry buna izin verir (`registry:publish` üzerine
yazar) ama tüketici tarafındaki pnpm tarball'ı önbelleğe aldığı için değişikliği görmeyebilir —
bunu bir kez yaşadık: yeniden yayınlanan tooling yerine önbellekteki eski sürüm çalıştı. Doğrusu
sürümü yükseltmektir; gerçek registry'ler zaten üzerine yazmayı yasaklar.

### Yayın provası

```bash
pnpm release:verify        # temiz bir app üretip registry'den kurar
pnpm release:verify --keep # geçici dizini silme (inceleme için)
```

Sırasıyla şunu yapar:

1. Boş bir porta geçici **Verdaccio** kaldırır (storage da geçici dizinde).
2. `pnpm run build:packages` ile dört paketin `dist`'ini üretir.
3. Beş paketi bu registry'ye yayınlar (`--tag rehearsal`).
4. `origin-create-app` ile **workspace dışında** bir uygulama üretir; kendi `.npmrc`'si ve boş
   `pnpm-workspace.yaml`'ı yazılır ki bu repoyu hiç görmesin.
5. Registry'den kurar; paketlerin `dist` artefaktını, dependency audit sonucunu ve destek dışı
   `uuid@10` veya altının lockfile'a girmediğini doğrular.
6. Kurulan uygulamada doctor strict, typecheck, import-cycle, lint, format, unit test, production
   build ve smoke kontrollerini çalıştırır. React provası ayrıca fixture contract ve bundle bütçesi
   kapılarını çalıştırır.
7. React provasında Chromium'u kurar; template'in Playwright/Axe suite'ini ve Lighthouse route
   bütçelerini production bundle'a karşı çalıştırır. Öncesinde kısa kapasite koşusu gerçek Autocannon
   dependency zincirini production bundle'a karşı çalıştırır. Vanilla provası browser bağımlılığı
   taşımaz.
8. Verdaccio'yu kapatır, geçici dizini siler.

**Neden gerekli:** repodaki diğer tüm kontroller paketleri `workspace:*` üzerinden `src/`'den
çözer. `dist` derlemesi, `publishConfig.exports` haritası, browser runtime ve paketler arası sürüm
bağları ancak gerçek bir registry'de buluşur. Prova ilk çalıştığında `origin-smoke`'un showroom'a özgü iki
beklenti taşıdığını ortaya çıkardı — üretilen her uygulama kendi smoke'undan kalıyordu.

---

### N-1 → N yükseltme provası

Release verify temiz ve güncel proje kurar; upgrade verify ise geçmişte oluşturulmuş gerçek bir
tüketiciyi ölçer. Registry hem önceki hem güncel sürümü taşımalıdır.

Önce local registry'yi açık tutup güncel sürümü yayınlayın, sonra pnpm upgrade:verify çalıştırın.
Kaynak sürümü ve registry gerektiğinde --from ile --registry seçenekleriyle sabitlenebilir.

Script önce published N-1 tooling ile workspace dışında React proje üretir ve baseline pnpm ci
çalıştırır. Ardından yalnız güncel tooling'i kurar; doctor'ın drift/pending migration gördüğünü
doğrular; migrate dry-run + apply + ikinci idempotence kontrolünü çalıştırır. Son olarak bütün
fixed group'u kurar, doctor strict ve generated pnpm ci kapısını geçirir.

Yeni bir sürüm yayınlanmadan önce şu üç test birbirinin yerine geçmez:

1. Workspace pnpm ci: platform kaynakları ve showroom.
2. Release verify: güncel published artefakttan temiz proje.
3. Upgrade verify: önceki published template/proje ile güncel sürüm arasındaki migration.

Uyumluluk politikası docs/compatibility.md, sürüm bazlı manuel/breaking adımlar
docs/migrations/ altında tutulur.

## 3. Yerel registry ile çalışmak (ekipler için)

`--workspace` modu platform geliştirmek içindir: uygulama `apps/<ad>` altında durur ve
`@originloom/*` paketleri **symlink** ile `packages/origin-*/src`'ye bağlanır, yani kaynağı
değiştirince anında görürsünüz.

Ürün ekiplerinin yaşayacağı akış ise farklıdır: uygulama **kendi reposunda** durur ve paketler bir
registry'den **kurulur**. Nexus hazır olana kadar bunu yerel bir Verdaccio ile birebir
deneyebilirsiniz.

### Registry'yi başlatın (bir terminalde açık kalır)

```bash
pnpm registry:local          # http://localhost:4873, Ctrl-C ile durur
```

Depolama `.verdaccio/storage` altındadır ve yeniden başlatmalarda korunur (git'e girmez).

### Paketleri yayınlayın (ikinci terminalde)

```bash
pnpm registry:publish        # build:packages + 5 paketi yerel registry'ye yayınlar
```

Yerel registry bir karalama defteridir: aynı sürümü yeniden yayınlamak **değiştirir**, hata vermez.
Gerçek bir registry buna izin vermez — orada sürüm yükseltirsiniz (§2).

### Uygulamayı repo dışında oluşturun

```bash
mkdir -p ~/projects && cd ~/projects
echo "@originloom:registry=http://localhost:4873" > .npmrc

pnpm --package=@originloom/tooling dlx origin-create-app yatirim-web \
  --title "Yatırım" --registry http://localhost:4873

cd yatirim-web && pnpm install && pnpm dev
```

İki `.npmrc` gerekiyor gibi görünmesi kasıtlı değil, npm'in davranışı: **npm yapılandırması üst
dizinlerden miras alınmaz.** Yukarıdaki ilk dosya `dlx` çağrısının tooling'i nereden çekeceğini,
`--registry` bayrağı ise üretilen uygulamanın kendi `.npmrc`'sini yazar.

Sonuç: `node_modules/@originloom/core` artık symlink değil, registry'den inen `dist`. Yani ekipler
tam olarak Nexus'a geçtiğimizde göreceği şeyi görür.

### Platformda değişiklik yaptığınızda

`pnpm registry:publish` ile yeniden yayınlayın. Aynı sürümü değiştirdiğiniz için **tüketici tarafında
önbellek** devreye girebilir; uygulamanın `pnpm install`'u eski tarball'ı kullanıyorsa
`pnpm store prune` (veya `~/Library/Caches/pnpm/dlx` temizliği) gerekir. Bu, gerçek registry'lerin
aynı sürümün yeniden yayınlanmasını neden yasakladığının canlı örneğidir — sık iterasyon için
`--workspace` modu daha uygundur.

---

## 4. Kararlar ve gerekçeleri

Bunlar sonradan "neden böyle yapmışız" diye sorulacak şeyler:

**Sabit (fixed) grup sürümleme.** Beş paket birbirine **tam sürümle** bağlı: yayınlanmış
`@originloom/core@0.2.0`, `"@originloom/shared": "0.2.0"` ister. Bağımsız sürümlerde tüketicinin
uyumlu kombinasyonu bulması gerekirdi; kısmi bir yayın çözülemez bir küme bırakırdı. Tek sürüm bu
soruyu ortadan kaldırır — bedeli, değişmeyen paketlerin de sürüm atlaması.

**`publishConfig.registry` yerel Verdaccio.** Provanın kendisi registry'yi zaten `--registry` ile
açıkça geçiyor; bu alan **kaza güvenliği** için: repoda elle `pnpm publish` çalıştıran biri npmjs'e
değil, ulaşamayacağı bir yerel adrese gider ve hata alır.

**`UNLICENSED` lisans.** Gerçek yayın kararı verilmediği için bilinçli yer tutucu. Yayına geçerken
seçilmesi zorunlu (§5).

**core'da küratlı export.** `ssr/*`, `cache/cold-fill`, `middleware/pipeline`, `app/*`, `document/*`
gibi 22 iç modül `exports` içinde `null` hedefiyle kapatıldı. Node en spesifik eşleşmeyi seçtiği
için `"./*"` wildcard'ı durmaya devam ediyor ama bunlar dışarı açılmıyor. Sebep: yayınlanan her
alt yol taahhüttür; iç boru hattını sonradan değiştirmek breaking release olurdu.
`packages/origin-core/tests/public-api.test.ts` iki export haritasının aynı şeyi kapattığını ve
kapatılanı paket dışından kimsenin import etmediğini doğrular.

**Smoke beklentileri opt-in.** `origin-smoke` artık yalnızca platform değişmezlerini denetler
(healthz, `/metrics` public değil, cluster metrikleri, HEAD + tracking cookie + `no-store`,
POST → 405). Uygulamaya özgü olanlar bayrakla verilir; showroom
`--expect-gone /kaldirildi --expect-ok /robots.txt` geçer.

---

## 5. Nexus'a geçiş: gerçek yayına geçerken yapılacaklar

**Planlanan hedef private Nexus registry'sidir.** Yukarıdaki yerel Verdaccio akışı bilinçli olarak
aynı şekle sahiptir — scope'lu registry, token ile publish, tüketicide `.npmrc`. Geçiş bu yüzden
kod değişikliği değil, **URL + kimlik bilgisi** değişikliğidir.

Sırayla:

### 5.1 Lisans seçin

Beş `package.json`'daki `"license": "UNLICENSED"` değerini gerçek lisansla değiştirin ve repo
köküne `LICENSE` dosyasını ekleyin.

- Şirket içi/kapalı kalacaksa: `UNLICENSED` kalabilir, ama `"private": true` **olmadığı** için
  yanlışlıkla public yayınlanabileceğini unutmayın; registry erişimini token ile kısıtlayın.
- Açık kaynak olacaksa: MIT veya Apache-2.0 (patent maddesi isterseniz ikincisi).

### 5.2 Hedef registry'yi belirleyin

Beş pakette `publishConfig.registry` değerini değiştirin:

```jsonc
// şirket içi
"publishConfig": { "registry": "https://<şirket-registry>/repository/npm-private/" }

// npmjs (public)
"publishConfig": { "registry": "https://registry.npmjs.org", "access": "public" }
```

npmjs kullanacaksanız **`@originloom` scope'unun sahipliğini önceden almanız** gerekir.

### 5.3 Kimlik doğrulama

CI'da `NODE_AUTH_TOKEN` (veya registry'ye özel token) secret'ı tanımlayın; `actions/setup-node`
adımına `registry-url` verin ki `.npmrc` otomatik yazılsın. Token'ı asla repoya koymayın.

### 5.4 Yayın workflow'u ekleyin

`release-verify` job'ı zaten kapı. Üstüne yayın adımı:

```yaml
release:
  needs: [verify, release-verify]
  if: startsWith(github.ref, 'refs/tags/v')
  runs-on: ubuntu-latest
  steps:
    # checkout + pnpm + node (registry-url ile) + install
    - run: pnpm run build:packages
    - run: pnpm exec changeset publish
      env:
        NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

`changeset publish` yalnızca registry'de bulunmayan sürümleri yayınlar ve git tag'lerini atar —
tekrar çalıştırmak zararsızdır.

### 5.5 İlk sürüm numarasına karar verin

`0.x` iken her minor breaking olabilir
sayılır; API'yi sabitlemeye hazır olduğunuzda `1.0.0`'a geçin. **`1.0.0`'dan sonra** küratlı export
listesini daraltmak major sürüm gerektirir — bu yüzden export yüzeyini şimdi gözden geçirin.

### 5.6 Tüketici tarafını ayarlayın

Yerel registry akışında kullandığınız komut Nexus'ta da aynıdır, yalnız URL değişir:

```bash
pnpm --package=@originloom/tooling dlx origin-create-app yatirim-web \
  --title "Yatırım" --registry https://nexus.<şirket>.com/repository/npm-group/
```

`--registry` üretilen uygulamanın `.npmrc`'sini yazar. Nexus okuma için de kimlik istiyorsa ekipler
o dosyaya token satırını ekler (veya `~/.npmrc`'de tutar — repoya girmesin).

`--version <aralık>` bağımlılık aralığını belirler. Varsayılan **generator'ın kendi sürümünden**
türetilir (`@originloom/tooling@0.2.1` → `^0.2.1`), yani elle güncellenecek bir yer değildir.

### 5.7 Yayın sonrası

- `pnpm release:verify` provayı **yerel** tutmaya devam etsin; gerçek registry'ye kurup doğrulayan
  ayrı bir "kurulum tazeliği" kontrolü isterseniz aynı script'e `--registry` parametresi eklenebilir.
- Yanlış yayınlanan bir sürümü `npm unpublish` ile geri çekmek yerine (72 saat sınırı ve
  tüketiciyi kırma riski) `npm deprecate` + düzeltilmiş yeni sürüm tercih edin.

---

## 6. Sorun giderme

| Belirti                                                           | Sebep ve çözüm                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENEEDAUTH ... requires you to be logged in`                      | npm istemcisi token olmadan publish denemez. Prova script'i sahte token'lı geçici `.npmrc` yazar; elle denerken siz de yazmalısınız.                                                 |
| `@originloom/shared is not in the npm registry`                   | Paketler birbirini **sürümle** ister. Tek bir tarball'ı tek başına kuramazsınız; hepsi aynı registry'de olmalı.                                                                      |
| `release:verify` `Verdaccio did not become ready` diyor           | 30 sn içinde ayağa kalkmadı. `--keep` ile çalıştırıp geçici dizindeki `verdaccio.yaml` ve stderr çıktısına bakın.                                                                    |
| Prova geçiyor ama `pnpm ci` düşüyor (veya tersi)                  | Farklı şeyleri ölçüyorlar: `ci` workspace'i, `release:verify` yayınlanmış artefaktı. İkisi de yeşil olmalı.                                                                          |
| Smoke `did not become healthy` yerine liste veriyor               | Beklenen davranış: artık hangi beklentinin kırıldığını yazar (`GET / responded 500` gibi).                                                                                           |
| Yeni bir core modülü dışarıdan import edilemiyor                  | `exports` içinde bir `null` bloğuna denk geliyor olabilir (`./ssr/*` gibi). Kasıtlıysa dokunmayın; değilse bloğu daraltın.                                                           |
| `pnpm registry:publish` → "No registry answering"                 | `pnpm registry:local` çalışmıyor. Ayrı bir terminalde başlatın.                                                                                                                      |
| Yerel registry'ye yeniden yayınladınız, tüketici eskiyi alıyor    | pnpm tarball'ı önbelleğe aldı: `pnpm store prune`, gerekirse `~/Library/Caches/pnpm/dlx` silin. Gerçek registry'lerin aynı sürümü yeniden yayınlatmamasının sebebi tam olarak budur. |
| Repo dışı uygulamada `@originloom/... is not in the npm registry` | Uygulamanın kendi `.npmrc`'si yok. `--registry` ile üretin veya dosyayı elle ekleyin — npm yapılandırması üst dizinden miras alınmaz.                                                |
