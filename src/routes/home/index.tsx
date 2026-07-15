import { defineRoute } from "../../lib/types";
import { sharedUnlessBypass } from "../../lib/cache-policy";
import { locale } from "../../lib/request";
import { defaultPageMeta } from "../../lib/shell-data";
import { generateMetaDataForPageWithDummySeoInfo } from "../../lib/metadata/generate";

export default defineRoute<{ locale: string }>({
  path: "/",
  cache: (ctx) => sharedUnlessBypass(ctx, ["home", locale(ctx.request)], { ttl: 3600 }),
  loader: async (ctx) => ({ data: { locale: locale(ctx.request) } }),
  generateMetadata: (_data, ctx) => generateMetaDataForPageWithDummySeoInfo("/", ctx),
  pageMeta: (_data, ctx) => defaultPageMeta(ctx, "home", { category: "landing" }),
  Component: () => (
    <>
      <h1>ssr-kit</h1>
      <ul>
        <li>
          <a href="/ihtiyac-kredisi/istanbul?amount=75000">/ihtiyac-kredisi/istanbul?amount=75000</a>
        </li>
        <li>
          <a href="/hesabim">/hesabim (never cached)</a>
        </li>
        <li>
          <a href="/blogs/paginated?page=2">/blogs/paginated?page=2</a>
        </li>
        <li>
          <a href="/emekli-bankaciligi">/emekli-bankaciligi → rewrite</a>
        </li>
        <li>
          <a href="/basvuru/kredi/yonlendirme">/basvuru/kredi/yonlendirme → rewrite</a>
        </li>
        <li>
          <a href="/eski-emeklilik">/eski-emeklilik → CMS redirect</a>
        </li>
        <li>
          <a href="/kaldirildi">/kaldirildi → 410</a>
        </li>
      </ul>
    </>
  ),
});
