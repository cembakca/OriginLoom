# Yeni Ürün Uygulaması Ekleme

Bu belge, `packages/origin-*` platformu üstüne **ikinci (ve sonraki) ürün uygulamasının** nasıl
kurulacağını anlatır. Hedef: cache, auth, middleware ve SSR pipeline'ını kopyalamadan, yalnızca
route tablosu + ürün kontratı yazarak yeni bir deployable üretmek.

İlgili: [multi-product-adoption.md](./multi-product-adoption.md) (neden bu model),
[ARCHITECTURE.md](../ARCHITECTURE.md#workspace-platform-ve-ürün-ayrımı) (kontrat detayı).

---

## 0. Hızlı yol: generator

Elle kurmak yerine CLI kullanın — aşağıdaki bölümlerin tamamını üretir. İki mod vardır:

- **standalone** (varsayılan): kendi reposunda duran, yayınlanmış `@originloom/*` paketlerine
  bağımlı bağımsız bir uygulama. Ayrı bir ekip/repo bunu kullanır ([multi-repo modeli](./multi-product-adoption.md#4-15-proje-tek-repo--15-proje-tek-deploy)).
- **`--workspace`**: bu monorepo içinde `apps/<ad>` altında, paketleri `workspace:*` ile bağlayan
  uygulama. Platform ekibinin pilot app'leri için.

```bash
pnpm create-app                                        # interaktif, standalone
pnpm create-app investment-web --title "Yatırım"       # standalone, cwd altına
pnpm create-app investment-web --target-dir ~/projects # başka bir üst dizine
pnpm create-app investment-web --version "^1.2.0"      # paket sürüm aralığını sabitle
pnpm create-app knowledge-web --workspace              # bu monorepo içinde apps/ altına
```

| Bayrak               | Anlamı                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--workspace`        | Uygulamayı monorepo içinde `apps/<ad>` altına, `workspace:*` bağımlılıklarıyla kurar. Bayrak yoksa standalone. |
| `--target-dir <yol>` | Standalone uygulamanın oluşturulacağı üst dizin. Varsayılan: içinde bulunduğunuz dizin.                        |
| `--version <aralık>` | Standalone modda `@originloom/*` bağımlılıklarının sürüm aralığı. Varsayılan `^0.1.0`.                         |
| `--port <n>`         | Uygulamanın portu (metrics portu `n + 6000`). Varsayılan `3010`.                                               |
| `--title "..."`      | Görünen ad; site metadata, layout ve README'de kullanılır.                                                     |

Üretilen uygulama çalışır durumdadır: SSR sayfası, hydrate olan örnek bir island, cache'li HTML,
`/healthz` ve `/readyz` hazır gelir. Standalone modda `pnpm install && pnpm dev`, workspace modda
repo kökünden `pnpm install` sonrası `pnpm --filter <ad> dev` ile ayağa kalkar. Sonraki bölümler
generator'ın ne ürettiğini ve neden öyle ürettiğini açıklar — elle kurmak veya üretileni değiştirmek
isteyenler için.

---

## 1. İskelet

`apps/showroom` referans implementasyondur. Yeni app için gereken minimum:

```text
apps/<product>-web/
  package.json          @originloom/core + @originloom/react (workspace:*)
  tsconfig.json         ../../tsconfig.base.json + ~/@server alias'ları
  vite.config.ts        createClientViteConfig(...)
  vite.server.config.ts createServerViteConfig({ noExternal: true })
  vitest.config.ts      (test yazılacaksa)
  .env.development / .env.production
  server/
    index.ts            composition root
    routes/             route tablosu
    product/            OriginRuntime implementasyonu
  src/
    entry.client.tsx    island bootstrap + globals.css
    hydrate.client.tsx  createIslandMounter({ modules })
    islands/            client giriş noktaları
    features/ components/ styles/
    lib/cache-keys.ts   bu ürünün sayfa cache registry'si
    lib/shell-data.ts   ShellData tipi ve cache-safe layout props
    lib/metadata/site-defaults.ts   site kimliği (ad, title template, OG)
    routing/rules.ts    redirect/rewrite kuralları
```

`pnpm-workspace.yaml` zaten `apps/*` kapsıyor; yeni klasör otomatik workspace üyesi olur.

> **Standalone modda fark:** `package.json` paketleri `workspace:*` yerine sabit sürüm aralığıyla
> (`--version`) referanslar, `tsconfig.json` ise `../../tsconfig.base.json`'a extends etmez —
> base derleyici seçenekleri inline gelir. `package.json` ayrıca kendi
> `pnpm.onlyBuiltDependencies` listesini taşır (monorepo'da bu kök `pnpm-workspace.yaml`'dan
> gelir), böylece `pnpm install` yerel native build script'lerini uyarısız çalıştırır. Yukarıdaki
> `apps/<product>-web/` ağacı yerine uygulama kendi reposunun kökünde durur. Kalan dosya yapısı iki
> modda da aynıdır.

---

## 2. Composition root

Platform hiçbir ürün modülünü import etmez; her şey burada bağlanır:

```ts
// apps/<product>-web/server/index.ts
import { serve } from "@hono/node-server";
import { createApp } from "@originloom/core/app";
import { readAssets } from "@originloom/core/assets";
import { initCache } from "@originloom/core/cache";
import { config, validateConfig } from "@originloom/core/config";
import { configureRouting } from "@originloom/react/routing";

import { mountApi } from "./api";
import { installProductRuntime } from "./product/runtime";
import { routes } from "./routes";
import { createRewrites, redirects, rewrites } from "~/routing/rules";

async function main() {
  installProductRuntime();
  configureRouting({ redirects, rewrites, createRewrites });
  validateConfig([validateProductConfig]);
  await initCache();

  const assets = readAssets({ eagerIslands: ["layout-client"] });
  const app = createApp({
    assets,
    routes,
    mounts: { api: mountApi },
  });

  serve({ fetch: app.fetch, port: config.port });
}
```

`routes` zorunludur — platformda default route tablosu yoktur.

---

## 3. Ürün kontratı (`OriginRuntime`)

Platformun ürüne sorduğu her şey tek bir nesnede toplanır:

```ts
// apps/<product>-web/server/product/runtime.ts
export const productRuntime: OriginRuntime<ShellData> = {
  fragments: productFragments, // header/footer vb. — ürün başına farklı
  buildShellData, // menü/chrome verisi
  isShellUsableForFragments: (shell) => Boolean(shell?.menu),
  document: productDocumentShell, // metadata, head slotları, layout, 404/500
  cacheKeys: { isKnownPageCachePrefix },
  onBotVisit: storeBotVisit, // opsiyonel
  metricSources: [myMetricLines], // opsiyonel — /metrics çıktısına eklenir
};

export function installProductRuntime() {
  installRuntime(productRuntime);
}
```

Minimum bir app için `fragments` boş `{}` olabilir; `document` ise zorunludur (layout ve
metadata olmadan document render edilemez).

---

## 4. Island registry

`import.meta.glob` bulunduğu dosyaya göre çözülür, bu yüzden pakete taşınamaz. Her app kendi
glob'unu verir:

```tsx
// src/hydrate.client.tsx
import { createIslandMounter, type IslandModule } from "@originloom/react/lib/client/island-mount";

export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.tsx"),
});
```

```tsx
// src/entry.client.tsx
import "./styles/globals.css";
import { runIslandBootstrap } from "@originloom/react/lib/client/island-runtime";

runIslandBootstrap((el) => {
  void import("./hydrate.client").then(({ mount }) => mount(el));
});
```

Tailwind kullanıyorsanız `globals.css` içinde paylaşılan paketleri taramayı unutmayın — workspace
modda paketin kaynağı, standalone modda kurulu `dist`'i:

```css
/* workspace */
@source "../../../../packages/origin-react/src";
/* standalone */
@source "../../node_modules/@originloom/react/dist";
```

---

## 5. Cache izolasyonu

Ortak Redis cluster kullanılabilir; ayrım `RELEASE_ID` üzerinden yapılır:

```
investment-web   RELEASE_ID=investment-4821   → ssr:investment-4821:...
knowledge-web    RELEASE_ID=knowledge-1192    → ssr:knowledge-1192:...
```

Purge API zaten release namespace'ine göre çalışır; bir ürünün purge'ü diğerini etkilemez.
Sayfa cache prefix'leri `src/lib/cache-keys.ts` içindeki registry'den gelir ve `isKnownPageCachePrefix`
ile platforma tanıtılır — böylece purge API bilinmeyen pageId'yi reddeder.

---

## 6. Build ve deploy

`package.json` script'leri tooling bin'lerine bağlanır:

```json
{
  "scripts": {
    "dev": "pnpm run icons && pnpm run media && origin-dev",
    "build": "origin-build",
    "start": "origin-run-with-env production node --enable-source-maps dist/server/index.js",
    "smoke": "origin-smoke",
    "check:cycles": "origin-check-cycles"
  }
}
```

Workspace modda Dockerfile `apps/showroom/Dockerfile`'ı kopyalayıp `--filter <product>-web` yapmak
yeterlidir; build context repo köküdür. Standalone modda ise generator'ın ürettiği Dockerfile
kendi kökünden build alır (`docker build -t <ad> .`) ve `pnpm install` sırasında `@originloom/*`
paketlerini registry'den çeker. Her iki durumda da server bundle'ı self-contained üretildiği için
runner imajı yalnız `dist/` taşır.

Her app kendi image'ını, kendi Deployment'ını ve kendi domain'ini alır. Biri deploy olurken
diğeri etkilenmez.

---

## 7. Platform değişikliği gerektiğinde

Ürün ekibi `packages/origin-core` içine ürün bilgisi **yazmaz**. İhtiyaç doğarsa:

1. Gereken şey zaten `OriginRuntime` veya `CreateAppOptions` üzerinden veriliyor mu — kontrol et.
2. Verilmiyor ise platform ekibiyle yeni bir hook konuş; hook generic olmalı (ürün adı geçmemeli).
3. `origin-check-cycles` katman ihlallerini (özellikle `@originloom/react → @originloom/core`)
   CI'da reddeder; kopyala-yapıştır platform kodu code review'da geri çevrilir.
