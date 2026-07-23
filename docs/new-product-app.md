# Yeni Ürün Uygulaması Ekleme

Bu belge, `packages/origin-*` platformu üstüne **ikinci (ve sonraki) ürün uygulamasının** nasıl
kurulacağını anlatır. Hedef: cache, auth, middleware ve SSR pipeline'ını kopyalamadan, yalnızca
route tablosu + ürün kontratı yazarak yeni bir deployable üretmek.

İlgili: [multi-product-adoption.md](./multi-product-adoption.md) (neden bu model),
[ARCHITECTURE.md](../ARCHITECTURE.md#workspace-platform-ve-ürün-ayrımı) (kontrat detayı).

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
    entry.client.tsx    island glob + globals.css
    hydrate.client.tsx  createIslandMounter({ modules })
    islands/            client giriş noktaları
    features/ components/ styles/
    lib/cache-keys.ts   bu ürünün sayfa cache registry'si
    routing/rules.ts    redirect/rewrite kuralları
```

`pnpm-workspace.yaml` zaten `apps/*` kapsıyor; yeni klasör otomatik workspace üyesi olur.

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

Tailwind kullanıyorsanız `globals.css` içinde paylaşılan paketleri taramayı unutmayın:

```css
@source "../../../../packages/origin-react/src";
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

Dockerfile `apps/showroom/Dockerfile`'ı kopyalayıp `--filter <product>-web` yapmak yeterlidir;
build context repo köküdür ve server bundle'ı self-contained üretildiği için runner imajı yalnız
`dist/` taşır.

Her app kendi image'ını, kendi Deployment'ını ve kendi domain'ini alır. Biri deploy olurken
diğeri etkilenmez.

---

## 7. Platform değişikliği gerektiğinde

Ürün ekibi `packages/origin-core` içine ürün bilgisi **yazmaz**. İhtiyaç doğarsa:

1. Gereken şey zaten `OriginRuntime` veya `CreateAppOptions` üzerinden veriliyor mu — kontrol et.
2. Verilmiyor ise platform ekibiyle yeni bir hook konuş; hook generic olmalı (ürün adı geçmemeli).
3. `origin-check-cycles` katman ihlallerini (özellikle `@originloom/react → @originloom/core`)
   CI'da reddeder; kopyala-yapıştır platform kodu code review'da geri çevrilir.
