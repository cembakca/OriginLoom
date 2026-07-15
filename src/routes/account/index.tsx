import { defineRoute } from "../../lib/types";
import { cookie } from "../../lib/request";

/**
 * No `cache` function at all -> never cached. That is the whole declaration.
 * Nothing had to be "opted out of".
 */
export default defineRoute<{ sid: string | undefined }>({
  path: "/hesabim",
  loader: async (ctx) => {
    const sid = cookie(ctx.request, "sid");
    if (!sid) return { data: { sid }, status: 401 };
    return { data: { sid } };
  },
  title: () => "Hesabım",
  Component: ({ data }) =>
    data.sid ? (
      <main>
        <h1>Hesabım</h1>
        <p>Oturum: {data.sid}</p>
      </main>
    ) : (
      <main>
        <h1>Giriş gerekli</h1>
      </main>
    ),
});
