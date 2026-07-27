# Changesets

The five `@originloom/*` packages are a **fixed group**: they always share one version and are
released together. That is deliberate — they depend on each other by exact version, so a partial
release would leave a consumer without a resolvable set.

## Adding a change

```bash
pnpm changeset          # describe the change; pick any @originloom package, the group follows
```

Commit the generated file in `.changeset/` with your PR.

## Releasing

```bash
pnpm changeset:version  # bumps all five, writes CHANGELOGs
pnpm release:verify     # publishes to a local Verdaccio and installs into a scratch app
```

`pnpm release:verify` is the gate: it proves the packages install and boot from a registry rather
than from the workspace. Publishing to a real registry is not wired up yet — `publishConfig.registry`
points at the local Verdaccio in every package, so no command here can reach npmjs by accident.

Why the group is fixed, what the rehearsal checks, and the checklist for switching to a real
registry: [docs/releasing.md](../docs/releasing.md).
