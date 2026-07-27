# @originloom/shared

The framework-neutral base of [OriginLoom](https://github.com/cembakca/OriginLoom). Pure
TypeScript, zero runtime dependencies. Both the server core and every renderer adapter build on it,
which is what keeps them from having to know about each other.

```bash
pnpm add @originloom/shared
```

## What is in here

| Entry                               | What it holds                                                       |
| ----------------------------------- | ------------------------------------------------------------------- |
| `@originloom/shared/lib/types`      | `Route`, `Ctx`, `CachePolicy`, `LoaderResult`, `defineRoute`        |
| `@originloom/shared/routing`        | Rewrite / redirect resolution, path patterns, public-URL policy     |
| `@originloom/shared/lib/metadata/*` | Metadata engine: site defaults, per-route merge, JSON-LD            |
| `@originloom/shared/render`         | `OriginRenderer` — the seam every renderer adapter implements       |
| `@originloom/shared/lib/client/*`   | DOM-only client helpers: island bootstrap, telemetry, api-fetch     |
| `@originloom/shared/lib/*`          | device, media, menu, cache policy, cookies, request, runtime schema |

## The render contract

`OriginRenderer` is why `@originloom/core` has no UI framework in it. The core resolves _what_ to
render — route content, boundaries, head assets, caching, streaming — and hands the result to
whatever implements this interface:

```ts
export interface OriginRenderer<Shell = unknown> {
  routeContent<T>(route: Route<T>, data: T, ctx: Ctx): FrameworkNode;
  notFoundContent(ctx: Ctx, route?: Route): FrameworkNode;
  errorContent(ctx: Ctx, route: Route, error: RouteError | null, status: number): FrameworkNode;
  renderNode(node: FrameworkNode): string;
  renderDocument(input: DocumentRenderInput<Shell>): string;
  renderDocumentToStream(
    input: DocumentRenderInput<Shell>,
    options: DocumentStreamOptions,
  ): Promise<StreamResult>;
}
```

`@originloom/react` and `@originloom/vanilla` are the two implementations that ship today.

## Route types

`Route<TData, TNode>` leaves the node type to the adapter. Apps import the pinned alias from their
renderer package (`@originloom/react/lib/types` or `@originloom/vanilla/lib/types`) so JSX or
`html` templates type-check; the core only ever sees the neutral default.
