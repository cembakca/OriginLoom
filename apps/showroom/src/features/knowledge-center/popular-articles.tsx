import { Link } from "@originloom/react/lib/link";

import { Badge } from "~/components/ui/badge";
import type { KnowledgeArticleSummary } from "~/lib/contracts/knowledge-center";

export function PopularKnowledgeArticles({ items }: { items: KnowledgeArticleSummary[] }) {
  return (
    <aside
      aria-labelledby="popular-knowledge-title"
      className="rounded-2xl border border-slate-200 bg-slate-950 p-6 text-white"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Badge className="border-white/20 bg-white/10 text-white">EN ÇOK OKUNANLAR</Badge>
          <h2 id="popular-knowledge-title" className="mt-3 text-2xl font-semibold">
            Popüler finans rehberleri
          </h2>
        </div>
        <Link href="/bilgi-merkezi" className="text-sm text-slate-300 hover:text-white">
          Tüm rehberler →
        </Link>
      </div>
      <ol className="mt-6 grid gap-5 md:grid-cols-3">
        {items.map((article, index) => (
          <li key={article.id} className="border-t border-white/20 pt-4">
            <span className="font-mono text-xs text-slate-400">0{index + 1}</span>
            <h3 className="mt-2 font-semibold leading-6">
              <Link href={`/bilgi-merkezi/${article.slug}`} className="hover:text-brand-200">
                {article.title}
              </Link>
            </h3>
            <p className="mt-2 text-xs text-slate-400">{article.readTimeMin} dk okuma</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
