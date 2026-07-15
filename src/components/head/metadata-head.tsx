import type { ResolvedMetadata } from "../../lib/metadata/types";

/** Metadata API çıktısı → HTML head tag'leri. GTM/analytics burada değil. */
export function MetadataHead({ meta }: { meta: ResolvedMetadata }) {
  return (
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <meta name="robots" content={meta.robots} />
      <link rel="canonical" href={meta.canonical} />

      <meta property="og:title" content={meta.openGraph.title} />
      <meta property="og:description" content={meta.openGraph.description} />
      <meta property="og:url" content={meta.openGraph.url} />
      <meta property="og:site_name" content={meta.openGraph.siteName} />
      <meta property="og:type" content={meta.openGraph.type} />
      <meta property="og:locale" content={meta.openGraph.locale} />
      {meta.openGraph.image ? <meta property="og:image" content={meta.openGraph.image} /> : null}

      <meta name="twitter:card" content={meta.twitter.card} />
      <meta name="twitter:title" content={meta.twitter.title} />
      <meta name="twitter:description" content={meta.twitter.description} />
      {meta.twitter.image ? <meta name="twitter:image" content={meta.twitter.image} /> : null}

      <link rel="icon" href={meta.icons.icon} />
      {meta.icons.apple ? <link rel="apple-touch-icon" href={meta.icons.apple} /> : null}
    </>
  );
}
