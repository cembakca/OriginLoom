import { responsiveImage } from "@server/media";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { ResponsiveImage } from "~/components/ui/responsive-image";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { imagePreload, type ResponsiveImageData } from "~/lib/media";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { locale } from "~/lib/request";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

const links = [
  {
    href: "/konut-kredisi?amount=2500000&term=120",
    label: "Konut kredileri",
    desc: "Filtrelenebilir ve cache-safe ürün karşılaştırma",
  },
  { href: "/hesabim", label: "Hesabım", desc: "neverCache + auth" },
  {
    href: "/kredi-kartlari/maximum",
    label: "Maximum Kart",
    desc: "Streaming kampanyalı ürün detayı",
  },
  { href: "/bilgi-merkezi", label: "Bilgi Merkezi", desc: "Fragment cache ve semantik pagination" },
  {
    href: "/medya-pipeline",
    label: "Image & font pipeline",
    desc: "Responsive, CDN unoptimized ve font subset demosu",
  },
  {
    href: "/basvuru/kredi/yonlendirme",
    label: "Başvuru yönlendirme",
    desc: "Minimal chrome route",
  },
  { href: "/eski-konut-kredisi", label: "CMS redirect", desc: "301 redirect örneği" },
  { href: "/kaldirildi", label: "410 Gone", desc: "Terminal CMS response" },
];

type Data = { locale: string; hero: ResponsiveImageData };

const HERO_SIZES = "(min-width: 1024px) 42vw, 100vw";

export default defineRoute<Data>({
  path: "/",
  cache: (ctx) => pageCachePolicy(PageCacheId.home, ctx),
  loader: async (ctx) => ({
    data: { locale: locale(ctx.request), hero: responsiveImage("home-hero") },
  }),
  generateMetadata: (_data, ctx) => generateMetaDataForPageWithDummySeoInfo("/", ctx),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "home", { category: "landing" }),
  preloadImages: (data) => [imagePreload(data.hero, HERO_SIZES)],
  Component: ({ data }) => (
    <div className="space-y-8">
      <div className="grid items-center gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-3">
          <Badge>ssr-kit demo</Badge>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            SSR + Tailwind + Radix
          </h1>
          <p className="max-w-2xl text-slate-600">
            Explicit cache, island hydration, GTM pipeline ve menu API — production-ready iskelet.
          </p>
        </div>
        <ResponsiveImage
          image={data.hero}
          sizes={HERO_SIZES}
          priority
          alt="Browser isteğinin Hono, cache ve gateway katmanlarından geçişi"
          className="aspect-video w-full rounded-2xl object-cover shadow-lg"
        />
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
