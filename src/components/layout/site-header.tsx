import type { UserProfile } from "../../services/user";

export type { UserProfile };

/** SSR-safe site header — user comes from loader (uncached routes) or anonymous shell. */
export function SiteHeader({ user }: { user?: UserProfile | null }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <a href="/">ssr-kit</a>
      {user ? (
        <span title={user.displayName}>{user.initials}</span>
      ) : (
        <a href="/giris">Giriş yap</a>
      )}
    </header>
  );
}
