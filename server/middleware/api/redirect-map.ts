import { gatewayFetch } from "./gateway";

export type CmsRedirectRule =
  | { kind: "redirect"; destination: string; status: number }
  | { kind: "gone" };

/** Mock CMS map — replace body with gatewayFetch('/redirects?path=…') in production. */
const MOCK_MAP: Record<string, CmsRedirectRule> = {
  "/eski-emeklilik": { kind: "redirect", destination: "/emekli-bankaciligi", status: 301 },
  "/kaldirildi": { kind: "gone" },
};

export async function lookupRedirect(pathname: string): Promise<CmsRedirectRule | null> {
  if (MOCK_MAP[pathname]) return MOCK_MAP[pathname];

  try {
    const res = await gatewayFetch(`/cms/redirects?path=${encodeURIComponent(pathname)}`, {
      method: "GET",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { type?: string; destination?: string; status?: number };
    if (data.type === "gone") return { kind: "gone" };
    if (data.destination) {
      return {
        kind: "redirect",
        destination: data.destination,
        status: data.status ?? 301,
      };
    }
  } catch {
    // GW unavailable — fall through to static rules.ts
  }

  return null;
}
