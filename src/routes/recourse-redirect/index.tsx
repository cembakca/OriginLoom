import { defineRoute } from "../../lib/types";

export default defineRoute<{ page: string; publicPath: string }>({
  path: "/recourse/:page/redirect",

  loader: async (ctx) => ({
    data: { page: ctx.params.page, publicPath: ctx.publicPath },
  }),

  title: (d) => `Başvuru yönlendirme — ${d.page}`,

  Component: ({ data }) => (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Başvuru yönlendirme</h1>
      <p>
        Param: <code>{data.page}</code>
      </p>
      <p>
        <code>/basvuru/{data.page}/yonlendirme</code> → <code>/recourse/{data.page}/redirect</code>
      </p>
    </main>
  ),
});
