import type { UserProfile } from "../../services/user";
import { fetchUserProfile } from "../../services/user";
import { SiteHeader } from "../../components/layout/site-header";
import { defineRoute } from "../../lib/types";
import { neverCache } from "../../lib/cache-policy";

type Data = {
  user: UserProfile | null;
};

/** Personal account — never shared cache; auth via middleware-injected Authorization. */
export default defineRoute<Data>({
  path: "/hesabim",
  cache: () => neverCache(),
  loader: async (ctx) => {
    const user = await fetchUserProfile(ctx.request);
    if (!user) return { data: { user: null }, status: 401 };
    return { data: { user } };
  },
  title: () => "Hesabım",
  Component: ({ data }) =>
    data.user ? (
      <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
        <SiteHeader user={data.user} />
        <h1>Hesabım</h1>
        <p>Hoş geldin, {data.user.displayName}</p>
      </main>
    ) : (
      <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
        <SiteHeader />
        <h1>Giriş gerekli</h1>
        <p>Oturum açmak için <code>access_token</code> veya <code>refresh_token</code> cookie kullanın.</p>
      </main>
    ),
});
