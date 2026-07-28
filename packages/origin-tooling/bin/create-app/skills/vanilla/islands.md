---
name: islands
description: Use when adding client-side interactivity or hydration to this OriginLoom app. Islands are the only client entry points — everything else is server-rendered static HTML. Covers hydrate vs defer, cache-safe personalization, the island registry, and props rules.
---

# Islands (client interactivity)

The page is server-rendered static HTML. The only interactive parts are
**islands**: elements that the client wakes up. If something needs an event
handler, a timer or a browser API, it must be an island. There is no UI framework
here — an island is a plain module that gets a DOM element and its props.

## Add one

1. Create `src/islands/<kebab-name>.ts` with a **default export**. The file name
   is the island name.

   ```ts
   import type { IslandMount } from "@originloom/vanilla/client/island-mount";

   const mount: IslandMount = (element, props) => {
     const button = element.querySelector("button");
     if (!button) return;

     let count = Number(props.start ?? 0);
     button.addEventListener("click", () => {
       count += 1;
       button.textContent = `Tıklandı: ${count}`;
     });
   };

   export default mount;
   ```

   The element already contains the server-rendered markup, so wire behaviour
   onto what is there instead of rebuilding it.

2. Place it on a page with `island()` (from `@originloom/vanilla/lib/island`):

   ```ts
   import { island } from "@originloom/vanilla/lib/island";

   island({
     name: "counter",
     props: { start: 0 },
     // server-rendered markup, visible before the chunk loads
     children: html`<button type="button">Tıklandı: 0</button>`,
   });
   ```

3. **Do not edit `entry.client.ts` or `hydrate.client.ts`.** `import.meta.glob`
   in `hydrate.client.ts` discovers every `src/islands/*.ts` automatically.

## `mode` — hydrate vs defer

- `mode="hydrate"` (default) — the server renders the markup and the client wakes
  it up. Interactive but **identical for every visitor**, so it is safe inside
  cached HTML.
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
- Build DOM with `textContent` / `setAttribute`, or with `html` on the server.
  Never assign untrusted strings to `innerHTML`.
