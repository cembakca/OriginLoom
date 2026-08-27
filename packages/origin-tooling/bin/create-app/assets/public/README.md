# {{ASSET_NAMESPACE}}-icons static files

Place unprocessed static files here. The OriginLoom server serves this directory under
`/{{ASSET_NAMESPACE}}-icons/*` in every environment (for example
`http://127.0.0.1:3010/{{ASSET_NAMESPACE}}-icons/test.img`).

This folder is for files that should not go through the Vite build or the media pipeline — PDFs,
verification tokens, downloadable assets, or legacy filenames that must stay stable.

Hashed client bundles and generated media live under `/{{ASSET_NAMESPACE}}/assets/*`.
When CDN delivery is enabled, upload or origin-pull this directory at
`{{ASSET_NAMESPACE}}-icons/*`. Replacing an unhashed filename requires a CDN purge.
