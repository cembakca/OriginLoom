import { Badge } from "~/components/ui/badge";
import type { KnowledgeArticleDetail } from "~/lib/contracts/knowledge-center";

export function KnowledgeArticlePage({ data }: { data: KnowledgeArticleDetail }) {
  const { article } = data;
  return (
    <article className="mx-auto max-w-5xl">
      <nav aria-label="İçerik yolu" className="mb-8 text-sm text-slate-500">
        <a href="/bilgi-merkezi" className="hover:text-brand-700">
          Bilgi Merkezi
        </a>{" "}
        <span aria-hidden="true">/</span> {article.title}
      </nav>
      <header className="grid gap-8 border-b border-slate-200 pb-10 lg:grid-cols-[1fr_16rem]">
        <div>
          <Badge>{article.category}</Badge>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-950 md:text-5xl">
            {article.title}
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">{article.excerpt}</p>
        </div>
        <dl className="space-y-4 border-l border-slate-200 pl-6 text-sm">
          <Meta label="Yazar" value={article.author} />
          <Meta label="Okuma" value={`${article.readTimeMin} dakika`} />
          <Meta
            label="Güncelleme"
            value={new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(
              new Date(article.updatedAt),
            )}
          />
        </dl>
      </header>
      <div className="grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-10">
          {article.sections.map((section) => (
            <section key={section.heading} className="scroll-mt-6">
              <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
              <p className="mt-4 text-base leading-8 text-slate-700">{section.body}</p>
            </section>
          ))}
          {article.faq.length ? (
            <section className="border-t border-slate-200 pt-8">
              <h2 className="text-2xl font-semibold">Sık sorulan sorular</h2>
              {article.faq.map((item) => (
                <details key={item.question} className="border-b border-slate-200 py-4">
                  <summary className="cursor-pointer font-medium">{item.question}</summary>
                  <p className="mt-3 leading-7 text-slate-600">{item.answer}</p>
                </details>
              ))}
            </section>
          ) : null}
        </div>
        <aside>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Etiketler
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <a
                key={tag}
                href={`/bilgi-merkezi?tag=${encodeURIComponent(tag.toLocaleLowerCase("tr-TR"))}`}
              >
                <Badge>{tag}</Badge>
              </a>
            ))}
          </div>
        </aside>
      </div>
      {data.related.length ? (
        <section className="border-t border-slate-200 pt-8">
          <h2 className="text-2xl font-semibold">İlgili içerikler</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {data.related.map((item) => (
              <a
                key={item.id}
                href={`/bilgi-merkezi/${item.slug}`}
                className="rounded-lg border border-slate-200 bg-white p-5 font-semibold hover:border-brand-300 hover:text-brand-700"
              >
                {item.title}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 font-medium text-slate-800">{value}</dd>
    </div>
  );
}
