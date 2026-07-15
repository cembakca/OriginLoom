# ssr-kit

Full-document React SSR. No meta-framework, no RSC, no route classification.

## The whole idea

Four steps. All four are your code.

1. Hono hands you the standard `Request`
2. A plain function reads cookies/headers/query from it and fetches data
3. `renderToString` turns the data into HTML
4. You return the HTML

There is no layer that watches what you read from the `Request`. Reading a
cookie is exactly as consequential as `JSON.parse` — it cannot have a side
effect, because no code exists to produce one.

## The contract

```ts
type Route<T> = {
  path: string
  cache?: (ctx) => CachePolicy      // pure, sync, runs BEFORE the loader
  loader: (ctx) => Promise<{ data: T }>
  Component: (props: { data: T }) => ReactElement
}
```

`cache()` is the entire caching mechanism. It sees the `Request` and returns a
key. Whatever is in the key fragments the cache. Whatever is not in the key
does not. Omit `cache()` and the route is never cached — nothing to opt out of.

See `src/routes/loan-compare.tsx`: it reads two cookies and three headers.
`theme` is in the key, so two HTML variants exist. `sid` is not, so signed-in
and anonymous visitors are served the same cached bytes.

Per-user content lives in `<Island mode="defer">` — the server never renders
it, so it never enters the cached HTML.

## Files

    server/
      index.ts      Hono. 25 lines. c.req.raw is the standard Request.
      handler.ts    The pipeline. Read it top to bottom; there is nothing else.
      document.tsx  renderToString of <html>. One <script> tag. No payload.
      cache.ts      HTML cache. Swap the Map for Redis to share across pods.
    src/
      lib/types.ts    The contract above.
      lib/match.ts    The router. 30 lines.
      lib/request.ts  cookie() / device() / locale(). Nothing clever.
      lib/island.tsx  hydrate | defer
      entry.client.tsx  Island mounter. import.meta.glob -> one chunk per island.
      routes/         Route table + three example routes.
      islands/        One file per island.

~450 lines total, including examples.

## Run

    npm install
    npm run build      # vite builds ONLY the client islands
    npm start          # http://localhost:3005

    npm run dev        # vite --watch + tsx watch

## Verify the claim

    # anonymous
    curl -sD- -o/dev/null 'localhost:3005/ihtiyac-kredisi/istanbul?amount=75000' | grep x-cache
    # -> MISS, then HIT

    # same URL with a session cookie
    curl -sD- -o/dev/null -H 'Cookie: sid=abc' 'localhost:3005/ihtiyac-kredisi/istanbul?amount=75000' | grep x-cache
    # -> HIT.  The cookie was read. Nothing was demoted.

    # a cookie you deliberately put in the key
    curl -sD- -o/dev/null -H 'Cookie: theme=dark' 'localhost:3005/ihtiyac-kredisi/istanbul?amount=75000' | grep x-cache
    # -> MISS. Because you asked for it.

## Measured on this scaffold (1 core, Node 22)

    renderToString, loan page      168 µs   -> ~5,900 renders/s/thread
    HTTP, cache hit                         ~14,000 req/s
    HTML size                      1.4 KB   1 <script> tag, no inline payload

## What you have to build yourself

    next/image      -> imgproxy sidecar + an <Img> wrapper
    next/font       -> @fontsource + manual <link rel=preload>
    i18n routing    -> strip the prefix before match(). ~40 lines.
    link prefetch   -> not present. public pages are MPA by design.
    error boundary  -> wrap handle() in try/catch, render an error route

This is the real cost. A few hundred lines, times 14 projects, maintained by you.
