import { neverCache } from "~/lib/cache-policy";
import { Island } from "~/lib/island";
import { publicAbsoluteUrl } from "~/lib/metadata/generate";
import { defaultPageMeta } from "~/lib/shell-data";
import { defineRoute } from "~/lib/types";

/**
 * Fragment Cache Demo Sayfası
 *
 * Bu sayfa bilerek hiç cache'lenmez (neverCache / BYPASS).
 * Amacı şunu göstermektir:
 *
 *   Sayfa cache'i olmasa dahi, pahalı bir widget'ı (API çağrısı gerektiren)
 *   fragment cache'e alarak o widget'ın maliyetini ortadan kaldırmak mümkündür.
 *
 * Akış:
 *   1. Her istek → sayfa sunucuda yeniden render edilir (BYPASS)
 *   2. Ama render sırasında <ssr-fragment name="popular-blogs"> etiketi bulunur
 *   3. Handler, bu etiketi Redis'te arar:
 *      - MISS → getPopularBlogs() çağrılır, render edilir, Redis'e yazılır (5 dakika TTL)
 *      - HIT  → Redis cache read, gateway isteği yok
 *   4. Sayfa, fragment HTML'i dikilmiş (stitched) olarak kullanıcıya döner
 */
export default defineRoute<Record<string, never>>({
  path: "/blogs/popular-fragments",

  // Sayfa asla cache'lenmez — her istekte sunucuda üretilir.
  // Fragment'lar ise kendi freshness/key kontratlarıyla Redis'ten beslenir.
  cache: () => neverCache(),

  loader: async () => ({ data: {} }),

  generateMetadata: (_data, ctx) => {
    const title = "Finans Rehberi & En Çok Okunanlar";
    const url = publicAbsoluteUrl(ctx, ctx.publicPath);
    return {
      title,
      description: "Finans ve bankacılık hakkında rehber içerikler.",
      canonical: url,
      openGraph: { title, url },
    };
  },

  pageMeta: (_data, ctx) =>
    defaultPageMeta(ctx, "fragment-cache-demo", {
      category: "content",
      mid: "popular-fragment",
    }),

  Component: () => (
    <div className="space-y-6">
      {/* ── Sayfa Başlığı ─────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Finans Rehberi</h1>
        <p className="mt-2 text-slate-500 text-sm">
          Bu sayfa her ziyarette sunucuda yeniden üretilir (Cache: BYPASS). Sağdaki widget ise beş
          dakikalık Redis fragment cache&apos;inden gelir.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ── Ana İçerik (BYPASS — her istekte render) ─────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Render kanıtı: tarayıcı saati, cache'ten etkilenmez */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 text-sm">
            <span className="text-slate-500">Bu sayfa render edildi:</span>
            <Island name="client-clock" mode="defer">
              <span className="font-mono text-slate-400">—</span>
            </Island>
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-600">
              Cache: BYPASS
            </span>
          </div>

          {/* Sayfa içeriği — basit statik metin bloğu */}
          {[
            {
              title: "Kredi Kullanmadan Önce Bilmeniz Gerekenler",
              excerpt:
                "Faiz oranlarını karşılaştırmak, toplam geri ödeme miktarını hesaplamak ve aylık taksit yükünüzü öğrenmek için nelere dikkat etmelisiniz?",
            },
            {
              title: "Emeklilik Planlamasında 5 Altın Kural",
              excerpt:
                "Bireysel emeklilik sistemi (BES) avantajlarından yararlanmak, birikim hedeflerinizi belirlemek ve uzun vadeli finansal güvence sağlamak için temel adımlar.",
            },
            {
              title: "Dijital Bankacılıkta Güvenliğinizi Koruyun",
              excerpt:
                "İki faktörlü doğrulama, güvenli bağlantı kontrolleri ve oltalama saldırılarına karşı alınabilecek pratik önlemler hakkında kapsamlı rehber.",
            },
          ].map((article) => (
            <article
              key={article.title}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-2"
            >
              <h2 className="text-lg font-semibold text-slate-800">{article.title}</h2>
              <p className="text-slate-500 text-sm leading-relaxed">{article.excerpt}</p>
              <a
                href="#"
                className="inline-block text-sm font-medium text-blue-600 hover:text-blue-800"
              >
                Devamını oku →
              </a>
            </article>
          ))}
        </div>

        {/* ── Sidebar: Fragment Cache Widget ────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Popüler İçerikler
            </p>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700">
              Fragment Cache: 5 Dakika
            </span>
          </div>

          {/*
           * <ssr-fragment name="popular-blogs">
           *
           * Sayfa BYPASS olmasına karşın bu alan Redis'ten gelir.
           * Handler (stitchCachedHtml) sayfayı render ettikten sonra bu
           * etiketi yakalar ve fragment:popular-blogs:v1 key'ini arar.
           *
           * HIT  → Redis'ten HTML okunur, gateway isteği yok.
           * MISS → getPopularBlogs() çağrılır, render → Redis'e yazılır.
           *
           * TTL dolana kadar sonraki isteklerde (sayfa BYPASS olsa bile) HIT gelir.
           */}
          <ssr-fragment name="popular-blogs" style={{ display: "contents" }}>
            <div className="animate-pulse bg-slate-100 border border-slate-200 h-64 rounded-xl" />
          </ssr-fragment>
        </div>
      </div>
    </div>
  ),
});
