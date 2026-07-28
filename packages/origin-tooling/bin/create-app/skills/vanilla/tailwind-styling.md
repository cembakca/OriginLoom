---
name: tailwind-styling
description: Use when writing styles or building UI in this OriginLoom app. Covers Tailwind CSS v4 usage, utility classes in JSX, the @source scanning gotcha for platform components, theme tokens, and conditional classes.
---

# Styling with Tailwind (v4)

Styling is Tailwind CSS v4 via `@tailwindcss/vite`. Utility classes go directly in
the `class` attribute; the Vite build turns them into the CSS shipped with the SSR
HTML.

```ts
html`<div class="mx-auto max-w-5xl px-4 py-10">
  <h1 class="text-3xl font-bold tracking-tight text-slate-900">Başlık</h1>
</div>`;
```

## `src/styles/globals.css`

```css
@import "tailwindcss";

/* Utility classes used by the platform packages render outside this app's own
   source, so Tailwind must scan them too. */
@source "../../node_modules/@originloom/vanilla/dist"; /* standalone */
@source "../../node_modules/@originloom/shared/dist"; /* standalone */
/* @source "../../../../packages/origin-vanilla/src"; ← workspace apps use this */
/* @source "../../../../packages/origin-shared/src";  ← workspace apps use this */

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}
```

### The @source gotcha

Tailwind only auto-scans this app's own files. Any classes that live **outside**
`src/` — the `@originloom/vanilla` / `@originloom/shared` markup, or a new
top-level directory you add —
will be missing from the CSS unless you add an explicit `@source` for them. If a
class silently has no effect, this is the first thing to check.

## Conditional classes

The `html` tag drops `false`, `null` and `undefined`, so a conditional class is
just an expression:

```ts
html`<button class="rounded-md px-4 py-2 ${active ? "bg-slate-900 text-white" : ""}">…</button>`;
```

> Note: `clsx` and `tailwind-merge` are **not** installed by default. Add them
> yourself if a page grows complex enough to need conflict-resolving merges.

## Keep pages SSR-safe

Everything under `src/pages/` and `src/components/` runs on the server. No
`window`, `document` or timers there — move interactivity into an island (see the
**islands** skill). Theme/design tokens belong in the `@theme` block, not
scattered magic values.
