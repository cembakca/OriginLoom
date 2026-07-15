import { defineRoute } from "../../lib/types";

export default defineRoute<{ publicPath: string }>({
  path: "/remote-customer-obtain",

  loader: async (ctx) => ({ data: { publicPath: ctx.publicPath } }),

  title: () => "Uzaktan Müşteri Edinimi",

  Component: ({ data }) => (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Uzaktan Müşteri Edinimi</h1>
      <p>
        Public URL: <code>{data.publicPath}</code> → internal <code>/remote-customer-obtain</code>
      </p>
    </main>
  ),
});
