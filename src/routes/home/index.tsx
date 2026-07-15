import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { locale } from "~/lib/request";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

const links = [
  {
    href: "/ihtiyac-kredisi/istanbul?amount=75000",
    label: "İhtiyaç kredisi",
    desc: "Cache + island filter örneği",
  },
  { href: "/hesabim", label: "Hesabım", desc: "neverCache + auth" },
  { href: "/blogs/paginated?page=2", label: "Blog paginated", desc: "SSR pagination island" },
  { href: "/emekli-bankaciligi", label: "Emekli bankacılığı", desc: "Rewrite + seoInfo metadata" },
  {
    href: "/basvuru/kredi/yonlendirme",
    label: "Başvuru yönlendirme",
    desc: "Minimal chrome route",
  },
  { href: "/eski-emeklilik", label: "CMS redirect", desc: "301 redirect test" },
  { href: "/kaldirildi", label: "410 Gone", desc: "Terminal CMS response" },
];

export default defineRoute<{ locale: string }>({
  path: "/",
  cache: (ctx) => pageCachePolicy(PageCacheId.home, ctx),
  loader: async (ctx) => ({ data: { locale: locale(ctx.request) } }),
  generateMetadata: (_data, ctx) => generateMetaDataForPageWithDummySeoInfo("/", ctx),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "home", { category: "landing" }),
  Component: () => (
    <div className="space-y-8">
      <div className="space-y-3">
        <Badge>ssr-kit demo</Badge>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          SSR + Tailwind + Radix
        </h1>
        <p className="max-w-2xl text-slate-600">
          Explicit cache, island hydration, GTM pipeline ve menu API — production-ready iskelet.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((link) => (
          <a key={link.href} href={link.href} className="group block">
            <Card className="h-full transition-shadow group-hover:shadow-md group-hover:border-brand-200">
              <CardHeader>
                <CardTitle className="text-base group-hover:text-brand-700">{link.label}</CardTitle>
                <CardDescription>{link.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  {link.href}
                </code>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  ),
});
