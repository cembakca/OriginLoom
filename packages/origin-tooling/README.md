# @originloom/tooling

The CLIs an [OriginLoom](https://github.com/cembakca/OriginLoom) app runs: dev, build, smoke,
scaffolding and the import-layering guard. Apps depend on it as a devDependency and call the
binaries from their package scripts.

```bash
pnpm add -D @originloom/tooling
```

## Scaffolding a new app

```bash
pnpm create-app investment-web              # standalone repo, React
pnpm create-app landing-web --vanilla       # no UI framework
pnpm create-app knowledge-web --workspace   # inside an OriginLoom monorepo
```

| Flag                 | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `--workspace`        | Generate into `apps/<name>` with `workspace:*` deps            |
| `--vanilla`          | Framework-free renderer (`--renderer vanilla`)                 |
| `--port <n>`         | App port; metrics on `n + 6000`, Vite dev server on `n + 2000` |
| `--vite-port <n>`    | Override the Vite dev-server port                              |
| `--target-dir <dir>` | Where a standalone app is written                              |
| `--version <range>`  | `@originloom/*` version range for a standalone app             |
| `--registry <url>`   | Writes the app's `.npmrc` so it installs `@originloom/*` there |

The generated app is formatted with Prettier on the way out, ships Claude Code skills matching its
renderer, and boots with a working SSR page, a hydrating island and a cached HTML response.

## Binaries

| Command                 | What it does                                                |
| ----------------------- | ----------------------------------------------------------- |
| `origin-dev`            | Vite dev server + SSR server (+ optional gateway) together  |
| `origin-build`          | Client bundle, then the self-contained SSR bundle           |
| `origin-smoke`          | Boots the built server and probes it                        |
| `origin-check-cycles`   | Import cycles, package layering, and the framework boundary |
| `origin-run-with-env`   | Runs a command with `.env.<app-env>` loaded                 |
| `origin-generate-icons` | SVG sources → typed components                              |
| `origin-build-media`    | Image/font pipeline for the asset manifest                  |
| `origin-compose-up`     | docker compose wrapper for the local stack                  |
