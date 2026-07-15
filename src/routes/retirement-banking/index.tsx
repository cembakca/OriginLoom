import { defineRoute } from "../../lib/types";
import { locale } from "../../lib/request";

export default defineRoute<{ publicPath: string }>({
  path: "/retirement-banking",

  cache: (ctx) => ({
    kind: "shared",
    ttl: 3600,
    swr: 86_400,
    key: ["retirement-banking", ctx.publicPath, locale(ctx.request)],
  }),

  loader: async (ctx) => ({ data: { publicPath: ctx.publicPath } }),

  title: () => "Emekli Bankacılığı",

  Component: ({ data }) => (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Emekli Bankacılığı</h1>
      <p>
        Internal route: <code>/retirement-banking</code>
      </p>
      <p>
        Public URL: <code>{data.publicPath}</code>
      </p>
      <p style={{ color: "#64748b" }}>
        Rewrite örneği — tarayıcıda <code>/emekli-bankaciligi</code> görünür, route matcher{" "}
        <code>/retirement-banking</code> dosyasını çalıştırır.
      </p>
    </main>
  ),
});
