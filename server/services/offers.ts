import { gatewayFetchForRequest } from "@server/adapters/gateway";

import type { Offer } from "~/lib/contracts/offers";

export async function getOffers(
  request: Request,
  query: { amount: number; city: string; device: string },
): Promise<Offer[]> {
  const search = new URLSearchParams({
    amount: String(query.amount),
    city: query.city,
    device: query.device,
  });
  const response = await gatewayFetchForRequest(request, `/offers?${search}`);
  if (!response.ok) throw new Error(`Offers gateway returned ${response.status}`);

  const data: unknown = await response.json();
  if (!isOffersPayload(data)) throw new Error("Offers gateway returned an invalid payload");
  return data;
}

function isOffersPayload(data: unknown): data is Offer[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).bank === "string" &&
        typeof (item as Record<string, unknown>).rate === "number" &&
        typeof (item as Record<string, unknown>).monthly === "number",
    )
  );
}
