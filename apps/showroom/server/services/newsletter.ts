import { gatewayFetchWithIdentity } from "@originloom/core/adapters/gateway";
import { readGatewayJson } from "@originloom/core/gateway-payload";
import { isRecord } from "@originloom/shared/lib/runtime-schema";
import { GatewayContracts } from "@server/services/gateway-contracts";

export type SubscribeResult = { kind: "ok" } | { kind: "duplicate" } | { kind: "unavailable" };

/**
 * Hands one address to the newsletter service.
 *
 * The three outcomes are deliberately not "threw or didn't": a duplicate is an
 * answer the visitor needs to read, and an outage is one the form has to survive
 * without losing what they typed.
 */
export async function subscribeToNewsletter(
  request: Request,
  email: string,
  name: string,
): Promise<SubscribeResult> {
  await using response = await gatewayFetchWithIdentity(request, "/newsletter/subscribers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name }),
  });

  if (response.status === 409) return { kind: "duplicate" };
  if (!response.ok) return { kind: "unavailable" };

  const payload = await readGatewayJson(response, GatewayContracts.newsletter, INVALID);
  return isRecord(payload) && payload.status === "duplicate"
    ? { kind: "duplicate" }
    : { kind: "ok" };
}

const INVALID = "Newsletter gateway returned an invalid payload";
