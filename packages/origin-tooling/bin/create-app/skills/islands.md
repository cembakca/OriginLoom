---
name: islands
description: Use when adding client-side interactivity or hydration to this OriginLoom app. Islands are the only client entry points — everything else is server-rendered static HTML. Covers hydrate vs defer, cache-safe personalization, the island registry, and props rules.
---

# Islands (client interactivity)

The page is server-rendered static HTML. The only interactive parts are
**islands**: small components that the client wakes up. If a component needs
`useState`, `useEffect`, an event handler or a browser API, it must be an island.

## Add one

1. Create `src/islands/<kebab-name>.tsx` with a **default export**. The file name
   is the island name.

   ```tsx
   import { useState } from "react";

   export default function Counter({ start = 0 }: { start?: number }) {
     const [count, setCount] = useState(start);
     return <button onClick={() => setCount((n) => n + 1)}>Tıklandı: {count}</button>;
   }
   ```

2. Place it on a page with `<Island>` (from `@originloom/react/lib/island`):

   ```tsx
   import { Island } from "@originloom/react/lib/island";

   <Island name="counter" props={{ start: 0 }}>
     {/* server-rendered fallback shown until hydration */}
     <button>Tıklandı: 0</button>
   </Island>;
   ```

3. **Do not edit `entry.client.tsx` or `hydrate.client.tsx`.** `import.meta.glob`
   in `hydrate.client.tsx` discovers every `src/islands/*.tsx` automatically.

## `mode` — hydrate vs defer

- `mode="hydrate"` (default) — the server renders it and the client wakes it up.
  Interactive but **identical for every visitor**, so it is safe inside cached
  HTML.
- `mode="defer"` — the server renders only the fallback; the client mounts the
  island and fetches its own data. This is where **anything per-user** goes. It
  never touches the cached HTML, so the cache key never needs a session
  dimension. This is the cache-safe personalization pattern (see **caching**).

## Rules

- **Props must be public, small and JSON-serializable.** Never pass tokens, PII or
  session data through island props — escaping does not make them safe.
- **Don't add `eager`.** Islands lazy-load as they approach the viewport. `eager`
  (download the chunk immediately) is only for early global state like analytics
  or a store seed — not ordinary widgets.
- Use `defer` + a client fetch for per-user data; keep it out of the SSR HTML.
