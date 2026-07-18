import type { KnowledgeArticle } from "~/lib/contracts/knowledge-center";

import type { JsonLdObject } from "./jsonld";

export function articleJsonLd(
  article: KnowledgeArticle,
  canonical: string,
  siteUrl: string,
): JsonLdObject {
  const base = siteUrl.replace(/\/$/, "");
  return {
    "@type": "Article",
    "@id": `${canonical}#article`,
    mainEntityOfPage: { "@id": `${canonical}#webpage` },
    headline: article.title,
    description: article.seo.description,
    image: new URL(article.imageUrl, canonical).toString(),
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: { "@type": "Person", name: article.author },
    publisher: { "@id": `${base}/#organization` },
    articleSection: article.category,
    keywords: article.tags,
    inLanguage: "tr-TR",
    isAccessibleForFree: true,
  };
}

export function faqJsonLd(items: Array<{ question: string; answer: string }>): JsonLdObject | null {
  if (items.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
