---
"@originloom/core": minor
"@originloom/shared": minor
"@originloom/tooling": minor
---

Namespaced public and client asset delivery, with an opt-in CDN switch.

Client bundles are served from `/<ASSET_NAMESPACE>/assets/*` and hand-placed files from
`public/<ASSET_NAMESPACE>-icons` at `/<ASSET_NAMESPACE>-icons/*`. `ASSET_CDN_URL` is inert
unless `ASSET_CDN_ENABLED=true`, so a stale CDN entry left in an environment cannot start
serving traffic on its own. `clientAssetUrl()` and `publicAssetUrl()` resolve both families
on the server; `assetUrl()` remains as a deprecated alias for the former. The legacy
`/assets/*` and `/public/*` routes still serve, but nothing the platform renders points at
them any more.

Two things this changes that are worth reading before upgrading:

**The four SEO images are content-hashed now.** `pnpm media` used to write `og-default.jpg`,
`brand-logo-512.png`, `apple-touch-icon.png` and `favicon-32.png` under those exact names,
and apps referenced them as string literals. They live in the namespace the server hands out
with `Cache-Control: max-age=31536000, immutable`, which is a promise a stable filename
cannot keep — replacing the OG image left every browser and CDN that had already fetched it
holding the old picture for a year, and this delivery model deliberately has no query-version
escape hatch. Read them from `seoAssets()` instead; the manifest is the only place that knows
their names. The Organization logo in JSON-LD moved the same way: the platform used to write
`${base}/assets/media/brand-logo-512.png` itself, which resolved only through the legacy route
and never reached the CDN. Apps now pass `organizationLogo` in their site metadata, and the
node is omitted when they do not.

**`IMAGE_CDN_URL` paths gained the namespace.** A media asset that was requested as
`${IMAGE_CDN_URL}/assets/media/…` is now requested as `${IMAGE_CDN_URL}/<namespace>/assets/media/…`.
The origin serves both, so origin-pull keeps working with no configuration change — but every
already-warm image CDN entry misses once after the deploy. Schedule the rollout accordingly, or
pre-warm.
