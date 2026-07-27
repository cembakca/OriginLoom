---
"@originloom/shared": minor
"@originloom/core": minor
"@originloom/react": minor
"@originloom/vanilla": minor
"@originloom/tooling": minor
---

Split the platform into a framework-neutral base, a framework-free server core and pluggable
renderer adapters.

- `@originloom/shared` is new: route and request types, the routing engine, the metadata engine, the
  DOM-only client helpers, and the `OriginRenderer` contract every adapter implements.
- `@originloom/core` no longer depends on a UI framework — no `react` dependency, no `.tsx`, not
  even a type import. It resolves what to render and hands it to the installed renderer. Its
  pipeline internals (`ssr/*`, `cache/cold-fill`, `middleware/pipeline`, …) are no longer exported.
- `@originloom/react` gains `./server`: `createReactRenderer` plus the document layout and streaming
  that used to live in the core.
- `@originloom/vanilla` is new: the same contract with strings instead of components — an `html`
  tagged template that escapes by default, island markers, and a plain-module island mounter.
- `@originloom/tooling` scaffolds either renderer (`origin-create-app --vanilla`), formats generated
  files with Prettier, and gives every app its own Vite dev port.
