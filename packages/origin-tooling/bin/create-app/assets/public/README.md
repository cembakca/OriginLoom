# Public static files

Place unprocessed static files here. The OriginLoom server serves them under `/public/*` on the
application port (for example `http://127.0.0.1:3010/public/test.img`).

This folder is for files that should not go through the Vite build or the media pipeline — PDFs,
verification tokens, downloadable assets, or legacy filenames that must stay stable.

Hashed client bundles and generated media continue to live under `/assets/*`.
