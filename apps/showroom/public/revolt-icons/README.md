# Revolt icons

Put unprocessed product icons and other stable public files in this directory. They are served at
`/revolt-icons/*` locally and at `${ASSET_CDN_URL}/revolt-icons/*` only when
`ASSET_CDN_ENABLED=true`.

These filenames are not query-versioned. Purge the CDN when replacing a file without changing its
name.
