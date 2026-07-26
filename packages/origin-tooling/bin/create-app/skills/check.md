---
name: check
description: Run this app's local quality gate — typecheck, import-cycle check, and tests — then fix anything that fails. Invoke manually with /check before committing or opening a PR.
disable-model-invocation: true
---

# Run the local quality gate

Run these in order and report the result of each. If a step fails, fix the cause
and re-run that step until it passes before moving on. Do not stop at the first
failure — get the whole gate green.

```bash
pnpm typecheck
pnpm check:cycles
pnpm lint
pnpm test
```

- `typecheck` — `tsc --noEmit`. Fix type errors at the source, not with `any` or
  `@ts-ignore`.
- `check:cycles` — no import cycles, and the platform layering holds: `core` and
  `react` never import each other, and neither `core` nor `shared` may import a UI
  framework. A failure usually means an import points the wrong way.
- `lint` — `eslint .`. Auto-fixable issues (import order, type imports): run
  `pnpm lint:fix`. Formatting is separate: `pnpm format`.
- `test` — `vitest run`. Fix the code or the test, whichever is actually wrong;
  don't delete assertions to go green.

When everything passes, give a one-line summary (e.g. "typecheck ✓ · cycles ✓ ·
lint ✓ · tests 42 ✓") so the state is clear before committing.
