import { config } from "@server/config";
import { responsiveImage, unoptimizedImage } from "@server/media";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { ResponsiveImage, UnoptimizedImage } from "~/components/ui/responsive-image";
import { PageCacheId, pageCachePolicy } from "~/lib/cache-keys";
import { imagePreload, type ResponsiveImageData, type UnoptimizedImageData } from "~/lib/media";
import { generateMetaDataForPageWithDummySeoInfo } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

const DEMO_SIZES = "(min-width: 1024px) 50vw, 100vw";

type Data = {
  responsive: ResponsiveImageData;
  unoptimized: UnoptimizedImageData;
  imageCdnEnabled: boolean;
  transformEnabled: boolean;
};

export default defineRoute<Data>({
  path: "/medya-pipeline",
  cache: (ctx) => pageCachePolicy(PageCacheId.mediaPipeline, ctx),
  loader: async () => ({
    data: {
      responsive: responsiveImage("home-hero"),
      unoptimized: unoptimizedImage("home-hero"),
      imageCdnEnabled: Boolean(config.imageCdnUrl),
      transformEnabled: Boolean(config.imageTransformUrl),
    },
  }),
  generateMetadata: (_data, ctx) => generateMetaDataForPageWithDummySeoInfo("/medya-pipeline", ctx),
  pageMeta: (_data, ctx) =>
    defaultPageMeta(ctx, "media-pipeline", { category: "engineering-demo" }),
  preloadImages: (data) => [imagePreload(data.responsive, DEMO_SIZES)],
  Component: ({ data }) => (
    <div className="space-y-10">
      <header className="max-w-3xl space-y-4">
        <Badge>Build çıktısı, browser kontratı</Badge>
        <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
          Image ve font pipeline
        </h1>
        <p className="text-lg leading-8 text-slate-600">
          Aynı kaynak görselin build-time responsive ve doğrudan CDN üzerinden unoptimized
          teslimini; self-host Inter variable font ile birlikte canlı DOM üzerinde karşılaştırın.
        </p>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <Status enabled={data.imageCdnEnabled} label="IMAGE_CDN_URL" />
          <Status enabled={data.transformEnabled} label="IMAGE_TRANSFORM_URL" />
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <ResponsiveImage
            image={data.responsive}
            sizes={DEMO_SIZES}
            priority
            alt="Hono SSR responsive image pipeline diyagramı"
            className="aspect-video w-full bg-slate-950 object-cover"
          />
          <CardHeader>
            <h2 className="text-lg font-semibold leading-none tracking-tight">Responsive teslim</h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
            <p>
              AVIF, WebP ve JPEG kaynakları ile 480–1600 px adayları üretir. Browser, gerçek slot
              genişliği ve cihaz piksel oranına göre uygun dosyayı seçer.
            </p>
            <ContractList
              values={[
                "Zorunlu intrinsic width / height",
                "srcset + sizes + <picture>",
                "LCP preload + fetchPriority=high",
                data.transformEnabled ? "Image transformer aktif" : "Build-time Sharp varyantları",
              ]}
            />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <UnoptimizedImage
            image={data.unoptimized}
            alt="CDN üzerinden dönüşümsüz sunulan SSR pipeline diyagramı"
            className="aspect-video w-full bg-slate-950 object-cover"
          />
          <CardHeader>
            <h2 className="text-lg font-semibold leading-none tracking-tight">
              Unoptimized CDN teslimi
            </h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
            <p>
              Dosya yeniden encode edilmez ve runtime image proxy’ye girmez. CDN prefix varsa
              manifestteki orijinal kaynağın önüne eklenir; absolute URL ise olduğu gibi korunur.
            </p>
            <ContractList
              values={[
                "Tek src, dönüşüm ve srcset yok",
                "Layout shift için width / height yine zorunlu",
                data.imageCdnEnabled ? "IMAGE_CDN_URL prefix aktif" : "Origin path kullanılıyor",
                "Varsayılan native lazy loading",
              ]}
            />
            <code className="block overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-200">
              {data.unoptimized.src}
            </code>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-3xl bg-slate-950 px-6 py-8 text-white sm:px-10 sm:py-12">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-3">
            <Badge className="border-white/15 bg-white/10 text-blue-100">
              Self-host variable font
            </Badge>
            <h2 className="text-3xl font-black tracking-tight">Inter, dış istek olmadan</h2>
            <p className="leading-7 text-slate-300">
              Latin ve Latin Extended WOFF2 subsetleri hash’lenir, preload edilir ve unicode-range
              ile eşleştirilir. Türkçe karakterler Latin Extended dosyasıyla karşılanır.
            </p>
          </div>
          <div className="space-y-5 border-l border-white/10 pl-6 sm:pl-10">
            <FontSample weight="300" label="Light" />
            <FontSample weight="500" label="Medium" />
            <FontSample weight="700" label="Bold" />
            <FontSample weight="900" label="Black" />
          </div>
        </div>
      </section>
    </div>
  ),
});

function Status({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={
        enabled
          ? "rounded-full bg-emerald-100 px-3 py-1 text-emerald-800"
          : "rounded-full bg-slate-200 px-3 py-1 text-slate-600"
      }
    >
      {label}: {enabled ? "aktif" : "kapalı"}
    </span>
  );
}

function ContractList({ values }: { values: string[] }) {
  return (
    <ul className="grid gap-2">
      {values.map((value) => (
        <li key={value} className="flex gap-2">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />
          {value}
        </li>
      ))}
    </ul>
  );
}

function FontSample({ weight, label }: { weight: string; label: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5rem_1fr] sm:items-baseline">
      <span className="text-xs font-semibold uppercase tracking-widest text-blue-300">{label}</span>
      <p className="text-2xl tracking-tight sm:text-3xl" style={{ fontWeight: weight }}>
        Çığ, şüphe, özgürlük — 0123456789
      </p>
    </div>
  );
}
