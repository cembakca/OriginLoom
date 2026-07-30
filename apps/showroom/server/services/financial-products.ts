import {
  gatewayFetch,
  releaseGatewayResponse,
  requireGatewayOk,
} from "@originloom/core/adapters/gateway";
import type { GatewayContract } from "@originloom/core/gateway-payload";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import {
  isBank,
  isCard,
  isCreditCardCampaignList,
  isCreditCardDetail,
  isCreditCardList,
  isHousingLoanDetail,
  isHousingLoanList,
  isLoan,
} from "@server/services/financial-product-guards";
import {
  createFinancialReferralGuards,
  isReferralStats,
} from "@server/services/financial-referral-guards";
import { createFinancialToolGuards } from "@server/services/financial-tool-guards";
import { GatewayContracts } from "@server/services/gateway-contracts";

import type { ReferralCreated, ReferralStats } from "~/lib/contracts/financial-products";

const INVALID_FINANCE = "Finance gateway returned an invalid payload";

const { isBankDetail, isCreditCardComparison, isLoanCalculatorData } = createFinancialToolGuards({
  isBank,
  isLoan,
  isCard,
});
const { isReferralCreated, isReferralDetail } = createFinancialReferralGuards(isBank);

export async function getHousingLoans(search: URLSearchParams, signal: AbortSignal) {
  return getJson(
    `/finance/housing-loans?${search}`,
    GatewayContracts.housingLoans,
    isHousingLoanList,
    signal,
  );
}

export async function getHousingLoan(slug: string, search: URLSearchParams, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/housing-loans/${encodeURIComponent(slug)}?${search}`,
    GatewayContracts.housingLoans,
    isHousingLoanDetail,
    signal,
  );
}

export async function getCreditCards(search: URLSearchParams, signal: AbortSignal) {
  return getJson(
    `/finance/credit-cards?${search}`,
    GatewayContracts.creditCards,
    isCreditCardList,
    signal,
  );
}

export async function getCreditCard(slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/credit-cards/${encodeURIComponent(slug)}`,
    GatewayContracts.creditCards,
    isCreditCardDetail,
    signal,
  );
}

export async function getCreditCardCampaigns(slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/credit-cards/${encodeURIComponent(slug)}/campaigns`,
    GatewayContracts.creditCards,
    isCreditCardCampaignList,
    signal,
  );
}

export async function getLoanCalculation(search: URLSearchParams, signal: AbortSignal) {
  return getJson(
    `/finance/calculators/loans?${search}`,
    GatewayContracts.financeTools,
    isLoanCalculatorData,
    signal,
  );
}

export async function getCreditCardComparison(search: URLSearchParams, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/credit-cards/compare?${search}`,
    GatewayContracts.financeTools,
    isCreditCardComparison,
    signal,
  );
}

export async function getBank(slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/banks/${encodeURIComponent(slug)}`,
    GatewayContracts.financeTools,
    isBankDetail,
    signal,
  );
}

export async function getReferral(productType: string, slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/referrals/${encodeURIComponent(productType)}/${encodeURIComponent(slug)}`,
    GatewayContracts.financeReferral,
    isReferralDetail,
    signal,
  );
}

export async function createReferral(
  productType: string,
  slug: string,
  anonymousSessionId: string,
  signal: AbortSignal,
): Promise<ReferralCreated | null> {
  const response = await gatewayFetch("/finance/referrals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productType, slug, anonymousSessionId }),
    signal,
  });
  if (response.status === 400 || response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Finance gateway returned");
  const payload = await readGatewayJson(
    response,
    GatewayContracts.financeReferral,
    INVALID_FINANCE,
  );
  return requireGatewayPayload(
    GatewayContracts.financeReferral,
    payload,
    isReferralCreated,
    INVALID_FINANCE,
  );
}

export async function getReferralStats(signal: AbortSignal): Promise<ReferralStats> {
  const response = await gatewayFetch("/internal/referrals/stats", { signal });
  await requireGatewayOk(response, "Referral stats gateway returned");
  const payload = await readGatewayJson(
    response,
    GatewayContracts.financeReferral,
    INVALID_FINANCE,
  );
  return requireGatewayPayload(
    GatewayContracts.financeReferral,
    payload,
    isReferralStats,
    INVALID_FINANCE,
  );
}

async function getJson<T>(
  path: string,
  contract: GatewayContract,
  guard: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<T> {
  const response = await gatewayFetch(path, { signal });
  await requireGatewayOk(response, "Finance gateway returned");
  const payload = await readGatewayJson(response, contract, INVALID_FINANCE);
  return requireGatewayPayload(contract, payload, guard, INVALID_FINANCE);
}

async function getOptionalJson<T>(
  path: string,
  contract: GatewayContract,
  guard: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<T | null> {
  const response = await gatewayFetch(path, { signal });
  if (response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Finance gateway returned");
  const payload = await readGatewayJson(response, contract, INVALID_FINANCE);
  return requireGatewayPayload(contract, payload, guard, INVALID_FINANCE);
}
