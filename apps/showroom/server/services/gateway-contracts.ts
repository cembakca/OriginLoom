import { defineGatewayContract } from "@originloom/core/gateway-payload";

/**
 * This product's gateway endpoints and the largest response each is allowed to
 * return. The budget is a safety limit, not an estimate: an upstream that
 * suddenly answers ten times its usual size is a defect, and reading it would
 * be the failure. Pick a ceiling above the realistic worst case.
 *
 * The platform does not know these names — they are ours, and every app writes
 * its own list.
 */
export const GatewayContracts = {
  account: defineGatewayContract("account", 131_072),
  blogs: defineGatewayContract("blogs", 524_288),
  creditCards: defineGatewayContract("credit_cards", 524_288),
  financeReferral: defineGatewayContract("finance_referral", 65_536),
  financeTools: defineGatewayContract("finance_tools", 1_048_576),
  housingLoans: defineGatewayContract("housing_loans", 524_288),
  knowledgeCenter: defineGatewayContract("knowledge_center", 1_048_576),
  markets: defineGatewayContract("markets", 524_288),
  menu: defineGatewayContract("menu", 262_144),
  newsletter: defineGatewayContract("newsletter", 4_096),
  offers: defineGatewayContract("offers", 131_072),
  page: defineGatewayContract("page", 65_536),
  popularBlogs: defineGatewayContract("popular_blogs", 524_288),
  profile: defineGatewayContract("profile", 16_384),
  routeDomains: defineGatewayContract("route_domains", 65_536),
  routing: defineGatewayContract("routing", 4_096),
  sitemap: defineGatewayContract("sitemap", 8_388_608),
} as const;
