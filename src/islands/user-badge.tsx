import { useEffect, useState } from "react";
import type { Me } from "../services/user";

/**
 * mode="defer". The server never runs this. It mounts on the client and
 * fetches its own data, which is why the surrounding HTML can be shared.
 */
export default function UserBadge() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  if (!me) return <a href="/giris">Giriş yap</a>;
  return <span title={`${me.savedCount} kayıtlı teklif`}>{me.initials}</span>;
}
