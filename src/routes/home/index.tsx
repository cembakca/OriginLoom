import { defineRoute } from "../../lib/types";
import { locale } from "../../lib/request";

export default defineRoute<{ locale: string }>({
  path: "/",
  cache: (ctx) => ({ kind: "shared", ttl: 3600, swr: 86_400, key: ["home", locale(ctx.request)] }),
  loader: async (ctx) => ({ data: { locale: locale(ctx.request) } }),
  title: () => "ssr-kit",
  Component: () => (
    <main>
      <h1>ssr-kit</h1>
      <ul>
        <li>
          <a href="/ihtiyac-kredisi/istanbul?amount=75000">/ihtiyac-kredisi/istanbul?amount=75000</a>
        </li>
        <li>
          <a href="/hesabim">/hesabim (uncached)</a>
        </li>
        <li>
          <a href="/blogs/paginated?page=2">/blogs/paginated?page=2</a>
        </li>
      </ul>
    </main>
  ),
});
