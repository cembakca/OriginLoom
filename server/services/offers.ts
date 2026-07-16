import { gatewayFetchForRequest } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";

import type { Offer } from "~/lib/contracts/offers";
import { isBoundedArray, isBoundedString, isFiniteNumber, isRecord } from "~/lib/runtime-schema";

const INVALID_OFFERS = "Offers gateway returned an invalid payload";
const MAX_OFFERS = 100;

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

  const data = await readGatewayJson(response, "offers", INVALID_OFFERS);
  return requireGatewayPayload("offers", data, isOffersPayload, INVALID_OFFERS);
}

function isOffersPayload(data: unknown): data is Offer[] {
  return isBoundedArray(data, MAX_OFFERS, isOffer);
}

function isOffer(item: unknown): item is Offer {
  return (
    isRecord(item) &&
    isBoundedString(item.id, 128) &&
    isBoundedString(item.bank, 120) &&
    isFiniteNumber(item.rate, { min: 0, max: 100 }) &&
    isFiniteNumber(item.monthly, { min: 0, max: 100_000_000 })
  );
}
