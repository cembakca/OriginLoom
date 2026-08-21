# @originloom/react

The React renderer for [OriginLoom](https://github.com/cembakca/OriginLoom): island runtime,
document rendering and the Vite preset. Implements the `OriginRenderer` contract from
`@originloom/shared`, so `@originloom/core` stays framework-free.

```bash
pnpm add @originloom/core @originloom/react @originloom/shared react react-dom
```

TanStack Query is optional. Install it only when using the query provider:

```bash
pnpm add @tanstack/react-query
```

## Renderer

Register the product's views once; the core calls them through the neutral contract:

```tsx
import { createReactRenderer } from "@originloom/react/server";

export const productRenderer = createReactRenderer<ShellData>({
  NotFoundComponent: NotFoundPage,
  ErrorComponent: RouteErrorPage,
  renderHeadStart: ({ seo, cspNonce }) => <MetadataHead meta={seo} nonce={cspNonce} />,
  renderHeadEnd: ({ cspNonce, isBot }) => <GtmBootstrap nonce={cspNonce} isBot={isBot} />,
  renderLayout: ({ shell, pageMeta, children }) => (
    <RootLayout shell={shell} pageMeta={pageMeta}>
      {children}
    </RootLayout>
  ),
});
```

`@originloom/react/server` pulls in `react-dom/server`; it belongs to the SSR bundle only and must
never be reached from the client entry.

Error views receive `{ error, status, errorId }`. `errorId` is the same opaque reference written to
the server's structured log and is safe to show to support users; unexpected exception details stay
server-only because `error` is `null` for thrown failures.

## Islands

The page is static HTML except for islands. `<Island>` emits the marker; the client mounter wakes
it up:

```tsx
import { Island } from "@originloom/react/lib/island";

<Island name="counter" props={{ start: 0 }}>
  <button>0</button>
</Island>;
```

```ts
// src/hydrate.client.tsx
import { createIslandMounter, type IslandModule } from "@originloom/react/lib/client/island-mount";
import { AppQueryProvider } from "@originloom/react/lib/query/provider";

export const mount = createIslandMounter({
  modules: import.meta.glob<IslandModule>("./islands/*.tsx"),
  Wrapper: AppQueryProvider,
});
```

`mode="hydrate"` (default) is safe inside cached HTML; `mode="defer"` renders only a fallback and
fetches its own data, which is where anything per-user belongs.

`Wrapper` is optional. It wraps each independently mounted island and is the integration point for
app-level providers such as TanStack Query. Omit it when the app does not need a provider.

## Other entries

| Entry                                          | What it does                                     |
| ---------------------------------------------- | ------------------------------------------------ |
| `@originloom/react/lib/types`                  | `Route` / `defineRoute` pinned to `ReactElement` |
| `@originloom/react/lib/link`                   | `<Link>` — the app's only internal link          |
| `@originloom/react/lib/request-context`        | The request identity views can read              |
| `@originloom/react/lib/metadata/metadata-head` | `<MetadataHead>` — metadata → head tags          |
| `@originloom/react/lib/query/provider`         | TanStack Query provider for islands              |
| `@originloom/react/vite`                       | Client and SSR Vite configs, dev-reload plugin   |

Tier 1 supported imports for generated apps: [docs/export-surface.md](../../docs/export-surface.md).
