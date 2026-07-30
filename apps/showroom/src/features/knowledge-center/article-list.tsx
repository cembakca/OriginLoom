import { Link } from "@originloom/react/lib/link";

import { CatalogPagination } from "~/components/catalog-pagination";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import type { KnowledgeArticleList } from "~/lib/contracts/knowledge-center";

const labels: Record<string, string> = {
  all: "Tüm içerikler",
  "konut-kredisi": "Konut Kredisi",
  "kredi-kartlari": "Kredi Kartları",
  krediler: "Krediler",
  yatirim: "Yatırım",
};

export function KnowledgeCenterPage({ data }: { data: KnowledgeArticleList }) {
  return (
    <div className="space-y-8">
      <header className="grid gap-6 border-b border-slate-200 pb-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
        <div className="space-y-3">
          <Badge>BİLGİ MERKEZİ</Badge>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight md:text-4xl">
            Finansal kararlar için açıklayıcı rehberler
          </h1>
          <p className="max-w-2xl leading-7 text-slate-600">
            Ürün karşılaştırmalarından farklı olarak burada kavramları, maliyetleri ve karar
            kriterlerini ayrıntılı ele alıyoruz.
          </p>
        </div>
        <form method="get" action="/bilgi-merkezi" role="search" className="flex gap-2">
          <label className="sr-only" htmlFor="knowledge-search">
            Bilgi Merkezi&apos;nde ara
          </label>
          <input
            id="knowledge-search"
            name="q"
            defaultValue={data.query.q ?? ""}
            placeholder="Konu ara…"
            className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button className={buttonVariants()} type="submit">
            Ara
          </button>
        </form>
      </header>
      <nav aria-label="İçerik kategorileri" className="flex flex-wrap gap-2">
        <Link
          href="/bilgi-merkezi"
          className={buttonVariants({
            variant: data.query.category === "all" ? "default" : "secondary",
            size: "sm",
          })}
        >
          Tüm içerikler
        </Link>
        {data.facets.categories.map((category) => (
          <Link
            key={category.value}
            href={`/bilgi-merkezi?category=${category.value}`}
            className={buttonVariants({
              variant: data.query.category === category.value ? "default" : "secondary",
              size: "sm",
            })}
          >
            {labels[category.value] ?? category.value}{" "}
            <span className="opacity-60">{category.count}</span>
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            {labels[data.query.category] ?? "Arama sonuçları"}
          </h2>
          <p className="text-sm text-slate-500">{data.pagination.total} içerik</p>
        </div>
        <form method="get" action="/bilgi-merkezi">
          <input type="hidden" name="category" value={data.query.category} />
          {data.query.q ? <input type="hidden" name="q" value={data.query.q} /> : null}
          <label className="text-sm text-slate-600">
            Sırala{" "}
            <select
              name="orderBy"
              defaultValue={data.query.orderBy}
              onChange={undefined}
              className="ml-2 h-9 rounded-md border border-slate-300 bg-white px-2"
            >
              <option value="date-desc">En yeni</option>
              <option value="date-asc">En eski</option>
              <option value="read-time-asc">Okuma süresi</option>
            </select>
          </label>
          <button className="sr-only" type="submit">
            Sırala
          </button>
        </form>
      </div>
      <section
        aria-label="Makaleler"
        className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3"
      >
        {data.items.map((article, index) => (
          <article key={article.id} className="group border-t-2 border-slate-950 pt-4">
            <div className="mb-8 flex items-start justify-between gap-4">
              <Badge>{labels[article.category] ?? article.category}</Badge>
              <span className="font-mono text-xs text-slate-400">0{index + 1}</span>
            </div>
            <h2 className="text-xl font-semibold leading-7">
              <Link href={`/bilgi-merkezi/${article.slug}`} className="group-hover:text-brand-700">
                {article.title}
              </Link>
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{article.excerpt}</p>
            <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
              <span>{article.author}</span>
              <span>{article.readTimeMin} dk okuma</span>
            </div>
          </article>
        ))}
      </section>
      <ssr-fragment name="popular-knowledge-articles" style={{ display: "contents" }}>
        <div
          aria-label="Popüler finans rehberleri yükleniyor"
          aria-busy="true"
          className="h-56 animate-pulse rounded-2xl bg-slate-200"
        />
      </ssr-fragment>
      <CatalogPagination
        pathname="/bilgi-merkezi"
        search={articleSearch(data)}
        page={data.pagination.page}
        totalPages={data.pagination.totalPages}
      />
    </div>
  );
}

function articleSearch(data: KnowledgeArticleList) {
  const search = new URLSearchParams({
    category: data.query.category,
    orderBy: data.query.orderBy,
  });
  if (data.query.q) search.set("q", data.query.q);
  if (data.query.tag) search.set("tag", data.query.tag);
  return search;
}
