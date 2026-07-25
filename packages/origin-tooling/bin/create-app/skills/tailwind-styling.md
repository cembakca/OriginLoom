---
name: tailwind-styling
description: Use when writing styles or building UI in this OriginLoom app. Covers Tailwind CSS v4 usage, utility classes in JSX, the @source scanning gotcha for platform components, theme tokens, and conditional classes.
---

# Styling with Tailwind (v4)

Styling is Tailwind CSS v4 via `@tailwindcss/vite`. Utility classes go directly in
`className`; the Vite build turns them into the CSS shipped with the SSR HTML.

```tsx
<div className="mx-auto max-w-5xl px-4 py-10">
  <h1 className="text-3xl font-bold tracking-tight text-slate-900">Başlık</h1>
</div>
```

## `src/styles/globals.css`

```css
@import "tailwindcss";

/* Utility classes used by the React package render outside this app's own
   source, so Tailwind must scan the package too. */
@source "../../node_modules/@originloom/react/dist"; /* standalone */
/* @source "../../../../packages/origin-react/src";   ← workspace apps use this */

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}
```

### The @source gotcha

Tailwind only auto-scans this app's own files. Any classes that live **outside**
`src/` — the `@originloom/react` components, or a new top-level directory you add —
will be missing from the CSS unless you add an explicit `@source` for them. If a
class silently has no effect, this is the first thing to check.

## Conditional classes

`clsx` is available for conditional class lists:

```tsx
import clsx from "clsx";

<button className={clsx("rounded-md px-4 py-2", active && "bg-slate-900 text-white")} />;
```

> Note: `tailwind-merge` / a `cn()` helper is **not** installed by default. If you
> need conflict-resolving merges, add `tailwind-merge` and wrap it yourself.

## Keep presentational components SSR-safe

Components under `src/features/` and `src/components/` render on the server. No
`useState`, `useEffect` or browser APIs there — move interactivity into an island
(see the **islands** skill). Theme/design tokens belong in the `@theme` block, not
scattered magic values.
