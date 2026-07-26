/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { serializeEmbeddedJson } from "@originloom/shared/lib/embedded-json";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";

/** Metadata API çıktısı → HTML head tag'leri. GTM/analytics burada değil. */
export function MetadataHead({
  meta,
  nonce,
}: {
  meta: ResolvedMetadata;
  nonce?: string | undefined;
}) {
  return (
    <>
      <title>{meta.title}</title>
      <meta name="application-name" content={meta.applicationName} />
      <meta name="description" content={meta.description} />
      <meta name="robots" content={meta.robots} />
      <meta
        name="format-detection"
        content={`telephone=${meta.formatDetection.telephone ? "yes" : "no"}`}
      />
      <link rel="canonical" href={meta.canonical} />
      {meta.pagination.previous ? <link rel="prev" href={meta.pagination.previous} /> : null}
      {meta.pagination.next ? <link rel="next" href={meta.pagination.next} /> : null}
      <OpenGraphHead meta={meta} />
      <TwitterHead meta={meta} />
      <VerificationHead meta={meta} />
      <StructuredDataHead meta={meta} nonce={nonce} />
      <link rel="icon" href={meta.icons.icon} />
      {meta.icons.apple ? <link rel="apple-touch-icon" href={meta.icons.apple} /> : null}
    </>
  );
}

function OpenGraphHead({ meta }: { meta: ResolvedMetadata }) {
  const openGraph = meta.openGraph;
  return (
    <>
      <meta property="og:title" content={openGraph.title} />
      <meta property="og:description" content={openGraph.description} />
      <meta property="og:url" content={openGraph.url} />
      <meta property="og:site_name" content={openGraph.siteName} />
      <meta property="og:type" content={openGraph.type} />
      <meta property="og:locale" content={openGraph.locale} />
      {openGraph.image ? <meta property="og:image" content={openGraph.image} /> : null}
      {openGraph.image ? <meta property="og:image:secure_url" content={openGraph.image} /> : null}
      {openGraph.imageAlt ? <meta property="og:image:alt" content={openGraph.imageAlt} /> : null}
      {openGraph.imageType ? <meta property="og:image:type" content={openGraph.imageType} /> : null}
      {openGraph.imageWidth ? (
        <meta property="og:image:width" content={String(openGraph.imageWidth)} />
      ) : null}
      {openGraph.imageHeight ? (
        <meta property="og:image:height" content={String(openGraph.imageHeight)} />
      ) : null}
      <ArticleOpenGraphHead meta={meta} />
    </>
  );
}

function ArticleOpenGraphHead({ meta }: { meta: ResolvedMetadata }) {
  const openGraph = meta.openGraph;
  return (
    <>
      {openGraph.publishedTime ? (
        <meta property="article:published_time" content={openGraph.publishedTime} />
      ) : null}
      {openGraph.modifiedTime ? (
        <meta property="article:modified_time" content={openGraph.modifiedTime} />
      ) : null}
      {openGraph.authors?.map((author) => (
        <meta key={author} property="article:author" content={author} />
      ))}
      {openGraph.section ? <meta property="article:section" content={openGraph.section} /> : null}
      {openGraph.tags?.map((tag) => (
        <meta key={tag} property="article:tag" content={tag} />
      ))}
    </>
  );
}

function TwitterHead({ meta }: { meta: ResolvedMetadata }) {
  const twitter = meta.twitter;
  return (
    <>
      <meta name="twitter:card" content={twitter.card} />
      <meta name="twitter:title" content={twitter.title} />
      <meta name="twitter:description" content={twitter.description} />
      {twitter.image ? <meta name="twitter:image" content={twitter.image} /> : null}
      {twitter.imageAlt ? <meta name="twitter:image:alt" content={twitter.imageAlt} /> : null}
      {twitter.site ? <meta name="twitter:site" content={twitter.site} /> : null}
      {twitter.creator ? <meta name="twitter:creator" content={twitter.creator} /> : null}
    </>
  );
}

function VerificationHead({ meta }: { meta: ResolvedMetadata }) {
  return Object.entries(meta.verification).map(([provider, value]) => (
    <meta key={provider} name={provider} content={value} />
  ));
}

function StructuredDataHead({
  meta,
  nonce,
}: {
  meta: ResolvedMetadata;
  nonce?: string | undefined;
}) {
  if (meta.structuredData.length === 0) return null;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: serializeEmbeddedJson({
          "@context": "https://schema.org",
          "@graph": meta.structuredData,
        }),
      }}
    />
  );
}
