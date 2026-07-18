import { observeInvalidGatewayPayload } from "@server/metrics";

export type GatewayPayloadContract =
  | "account"
  | "auth_refresh"
  | "blogs"
  | "credit_cards"
  | "finance_referral"
  | "housing_loans"
  | "knowledge_center"
  | "markets"
  | "popular_blogs"
  | "menu"
  | "offers"
  | "page"
  | "profile"
  | "redirect"
  | "route_domains";

type InvalidPayloadReason = "json" | "schema" | "size";

const MAX_PAYLOAD_BYTES: Record<GatewayPayloadContract, number> = {
  account: 131_072,
  auth_refresh: 16_384,
  blogs: 524_288,
  credit_cards: 524_288,
  finance_referral: 65_536,
  housing_loans: 524_288,
  knowledge_center: 1_048_576,
  markets: 524_288,
  popular_blogs: 524_288,
  menu: 262_144,
  offers: 131_072,
  page: 65_536,
  profile: 16_384,
  redirect: 16_384,
  route_domains: 65_536,
};

export class GatewayPayloadError extends Error {
  constructor(
    readonly contract: GatewayPayloadContract,
    readonly reason: InvalidPayloadReason,
    message: string,
  ) {
    super(message);
    this.name = "GatewayPayloadError";
  }
}

export async function readGatewayJson(
  response: Response,
  contract: GatewayPayloadContract,
  message: string,
): Promise<unknown> {
  const maxBytes = MAX_PAYLOAD_BYTES[contract];
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      throw invalidPayload(contract, "size", message);
    }
  }

  const text = await readBoundedText(response, maxBytes, () =>
    invalidPayload(contract, "size", message),
  );

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidPayload(contract, "json", message);
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  sizeError: () => GatewayPayloadError,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw sizeError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function requireGatewayPayload<T>(
  contract: GatewayPayloadContract,
  value: unknown,
  guard: (value: unknown) => value is T,
  message: string,
): T {
  if (!guard(value)) throw invalidPayload(contract, "schema", message);
  return value;
}

export function parseGatewayPayload<T>(
  contract: GatewayPayloadContract,
  value: unknown,
  parser: (value: unknown) => T | null,
  message: string,
): T {
  const parsed = parser(value);
  if (parsed === null) throw invalidPayload(contract, "schema", message);
  return parsed;
}

export function invalidPayload(
  contract: GatewayPayloadContract,
  reason: InvalidPayloadReason,
  message: string,
): GatewayPayloadError {
  observeInvalidGatewayPayload(contract, reason);
  return new GatewayPayloadError(contract, reason, message);
}
