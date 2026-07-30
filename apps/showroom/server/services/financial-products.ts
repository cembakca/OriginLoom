import {
  gatewayFetchWithIdentity,
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

export async function getHousingLoans(search: URLSearchParams, request: Request) {
  return getJson(
    `/finance/housing-loans?${search}`,
    GatewayContracts.housingLoans,
    isHousingLoanList,
    request,
  );
}

export async function getHousingLoan(slug: string, search: URLSearchParams, request: Request) {
  return getOptionalJson(
    `/finance/housing-loans/${encodeURIComponent(slug)}?${search}`,
    GatewayContracts.housingLoans,
    isHousingLoanDetail,
    request,
  );
}

export async function getCreditCards(search: URLSearchParams, request: Request) {
  return getJson(
    `/finance/credit-cards?${search}`,
    GatewayContracts.creditCards,
    isCreditCardList,
    request,
  );
}

export async function getCreditCard(slug: string, request: Request) {
  return getOptionalJson(
    `/finance/credit-cards/${encodeURIComponent(slug)}`,
    GatewayContracts.creditCards,
    isCreditCardDetail,
    request,
  );
}

export async function getCreditCardCampaigns(slug: string, request: Request) {
  return getOptionalJson(
    `/finance/credit-cards/${encodeURIComponent(slug)}/campaigns`,
    GatewayContracts.creditCards,
    isCreditCardCampaignList,
    request,
  );
}

export async function getLoanCalculation(search: URLSearchParams, request: Request) {
  return getJson(
    `/finance/calculators/loans?${search}`,
    GatewayContracts.financeTools,
    isLoanCalculatorData,
    request,
  );
}

export async function getCreditCardComparison(search: URLSearchParams, request: Request) {
  return getOptionalJson(
    `/finance/credit-cards/compare?${search}`,
    GatewayContracts.financeTools,
    isCreditCardComparison,
    request,
  );
}

export async function getBank(slug: string, request: Request) {
  return getOptionalJson(
    `/finance/banks/${encodeURIComponent(slug)}`,
    GatewayContracts.financeTools,
    isBankDetail,
    request,
  );
}

export async function getReferral(productType: string, slug: string, request: Request) {
  return getOptionalJson(
    `/finance/referrals/${encodeURIComponent(productType)}/${encodeURIComponent(slug)}`,
    GatewayContracts.financeReferral,
    isReferralDetail,
    request,
  );
}

export async function createReferral(
  productType: string,
  slug: string,
  anonymousSessionId: string,
  request: Request,
): Promise<ReferralCreated | null> {
  const response = await gatewayFetchWithIdentity(request, "/finance/referrals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productType, slug, anonymousSessionId }),
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

export async function getReferralStats(request: Request): Promise<ReferralStats> {
  const response = await gatewayFetchWithIdentity(request, "/internal/referrals/stats");
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
  request: Request,
): Promise<T> {
  const response = await gatewayFetchWithIdentity(request, path);
  await requireGatewayOk(response, "Finance gateway returned");
  const payload = await readGatewayJson(response, contract, INVALID_FINANCE);
  return requireGatewayPayload(contract, payload, guard, INVALID_FINANCE);
}

async function getOptionalJson<T>(
  path: string,
  contract: GatewayContract,
  guard: (value: unknown) => value is T,
  request: Request,
): Promise<T | null> {
  const response = await gatewayFetchWithIdentity(request, path);
  if (response.status === 404) {
    await releaseGatewayResponse(response);
    return null;
  }
  await requireGatewayOk(response, "Finance gateway returned");
  const payload = await readGatewayJson(response, contract, INVALID_FINANCE);
  return requireGatewayPayload(contract, payload, guard, INVALID_FINANCE);
}
