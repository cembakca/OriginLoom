import { gatewayFetch } from "@originloom/core/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@originloom/core/gateway-payload";
import {
  createFinancialReferralGuards,
  isReferralStats,
} from "@server/services/financial-referral-guards";
import { createFinancialToolGuards } from "@server/services/financial-tool-guards";
import {
  isInteger,
  isNumber,
  isOptionalString,
  isPagination,
  isRecord,
  isString,
  isStringArray,
  MAX_COLLECTION,
} from "@server/services/gateway-guards";
import { isSeoInfo } from "@server/services/seo-info";

import type {
  CreditCard,
  CreditCardCampaign,
  CreditCardCampaignList,
  CreditCardDetail,
  CreditCardList,
  HousingLoan,
  HousingLoanDetail,
  HousingLoanList,
  ProductBank,
  ReferralCreated,
  ReferralStats,
} from "~/lib/contracts/financial-products";

const INVALID_FINANCE = "Finance gateway returned an invalid payload";

const { isBankDetail, isCreditCardComparison, isLoanCalculatorData } = createFinancialToolGuards({
  isBank,
  isLoan,
  isCard,
});
const { isReferralCreated, isReferralDetail } = createFinancialReferralGuards(isBank);

export async function getHousingLoans(search: URLSearchParams, signal: AbortSignal) {
  return getJson(`/finance/housing-loans?${search}`, "housing_loans", isHousingLoanList, signal);
}

export async function getHousingLoan(slug: string, search: URLSearchParams, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/housing-loans/${encodeURIComponent(slug)}?${search}`,
    "housing_loans",
    isHousingLoanDetail,
    signal,
  );
}

export async function getCreditCards(search: URLSearchParams, signal: AbortSignal) {
  return getJson(`/finance/credit-cards?${search}`, "credit_cards", isCreditCardList, signal);
}

export async function getCreditCard(slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/credit-cards/${encodeURIComponent(slug)}`,
    "credit_cards",
    isCreditCardDetail,
    signal,
  );
}

export async function getCreditCardCampaigns(slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/credit-cards/${encodeURIComponent(slug)}/campaigns`,
    "credit_cards",
    isCreditCardCampaignList,
    signal,
  );
}

export async function getLoanCalculation(search: URLSearchParams, signal: AbortSignal) {
  return getJson(
    `/finance/calculators/loans?${search}`,
    "finance_tools",
    isLoanCalculatorData,
    signal,
  );
}

export async function getCreditCardComparison(search: URLSearchParams, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/credit-cards/compare?${search}`,
    "finance_tools",
    isCreditCardComparison,
    signal,
  );
}

export async function getBank(slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/banks/${encodeURIComponent(slug)}`,
    "finance_tools",
    isBankDetail,
    signal,
  );
}

export async function getReferral(productType: string, slug: string, signal: AbortSignal) {
  return getOptionalJson(
    `/finance/referrals/${encodeURIComponent(productType)}/${encodeURIComponent(slug)}`,
    "finance_referral",
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
  if (response.status === 400 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Finance gateway returned ${response.status}`);
  const payload = await readGatewayJson(response, "finance_referral", INVALID_FINANCE);
  return requireGatewayPayload("finance_referral", payload, isReferralCreated, INVALID_FINANCE);
}

export async function getReferralStats(signal: AbortSignal): Promise<ReferralStats> {
  const response = await gatewayFetch("/internal/referrals/stats", { signal });
  if (!response.ok) throw new Error(`Referral stats gateway returned ${response.status}`);
  const payload = await readGatewayJson(response, "finance_referral", INVALID_FINANCE);
  return requireGatewayPayload("finance_referral", payload, isReferralStats, INVALID_FINANCE);
}

async function getJson<T>(
  path: string,
  contract: "housing_loans" | "credit_cards" | "finance_tools",
  guard: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<T> {
  const response = await gatewayFetch(path, { signal });
  if (!response.ok) throw new Error(`Finance gateway returned ${response.status}`);
  const payload = await readGatewayJson(response, contract, INVALID_FINANCE);
  return requireGatewayPayload(contract, payload, guard, INVALID_FINANCE);
}

async function getOptionalJson<T>(
  path: string,
  contract: "housing_loans" | "credit_cards" | "finance_referral" | "finance_tools",
  guard: (value: unknown) => value is T,
  signal: AbortSignal,
): Promise<T | null> {
  const response = await gatewayFetch(path, { signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Finance gateway returned ${response.status}`);
  const payload = await readGatewayJson(response, contract, INVALID_FINANCE);
  return requireGatewayPayload(contract, payload, guard, INVALID_FINANCE);
}

function isBank(value: unknown): value is ProductBank {
  return (
    isRecord(value) &&
    isString(value.slug, 80) &&
    isString(value.name, 160) &&
    isString(value.logoUrl, 500)
  );
}

function isLoan(value: unknown): value is HousingLoan {
  if (!isRecord(value) || !isRecord(value.calculation)) return false;
  return isLoanIdentity(value) && isLoanTerms(value) && isLoanCalculation(value.calculation);
}

function isLoanIdentity(value: Record<string, unknown>): boolean {
  return (
    isString(value.id, 120) &&
    isString(value.slug, 120) &&
    value.productType === "housing-loan" &&
    isBank(value.bank) &&
    isString(value.name, 240) &&
    isString(value.summary) &&
    isNumber(value.interestRate, 0, 100) &&
    isNumber(value.annualCostRate, 0, 1_000) &&
    isNumber(value.minAmount) &&
    isNumber(value.maxAmount) &&
    isNumber(value.allocationFeeRate, 0, 100) &&
    isNumber(value.appraisalFee) &&
    isNumber(value.maxLoanToValue, 0, 100) &&
    typeof value.featured === "boolean"
  );
}

function isLoanTerms(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.terms) &&
    value.terms.length <= 30 &&
    value.terms.every((term) => isInteger(term, 1, 600)) &&
    isStringArray(value.badges, 10, 80) &&
    isStringArray(value.requirements, 20) &&
    isStringArray(value.features, 20)
  );
}

function isLoanCalculation(value: Record<string, unknown>): boolean {
  return (
    isNumber(value.amount) &&
    isInteger(value.term, 1, 600) &&
    isNumber(value.monthlyPayment) &&
    isNumber(value.totalPayment) &&
    isNumber(value.allocationFee) &&
    isNumber(value.appraisalFee)
  );
}

function isHousingLoanList(value: unknown): value is HousingLoanList {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_COLLECTION &&
    value.items.every(isLoan) &&
    isPagination(value.pagination) &&
    isRecord(value.query) &&
    isNumber(value.query.amount) &&
    isInteger(value.query.term, 1, 600) &&
    isString(value.query.city, 80) &&
    isOptionalString(value.query.bank, 80) &&
    isString(value.query.sortBy, 80) &&
    isRecord(value.facets) &&
    Array.isArray(value.facets.banks) &&
    value.facets.banks.length <= MAX_COLLECTION &&
    value.facets.banks.every(isFacet) &&
    Array.isArray(value.facets.terms) &&
    value.facets.terms.every((term) => isInteger(term, 1, 600)) &&
    isStringArray(value.facets.cities, 50, 80)
  );
}

function isHousingLoanDetail(value: unknown): value is HousingLoanDetail {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    isLoan(value.product) &&
    isStringArray(value.disclosures, 20, 2_000)
  );
}

function isCampaign(value: unknown): value is CreditCardCampaign {
  return (
    isRecord(value) &&
    isString(value.id, 160) &&
    isString(value.category, 80) &&
    isString(value.title, 240) &&
    isString(value.description) &&
    isString(value.startsAt, 64) &&
    isString(value.endsAt, 64) &&
    isString(value.participation, 240) &&
    isString(value.termsUrl, 500)
  );
}

function isCard(value: unknown): value is CreditCard {
  if (!isRecord(value)) return false;
  return isCardIdentity(value) && isCardBenefits(value);
}

function isCardIdentity(value: Record<string, unknown>): boolean {
  return (
    isString(value.id, 120) &&
    isString(value.slug, 120) &&
    value.productType === "credit-card" &&
    isBank(value.bank) &&
    isString(value.name, 240) &&
    isString(value.cardType, 80) &&
    isString(value.network, 80) &&
    isNumber(value.annualFee) &&
    isNumber(value.minMonthlyIncome) &&
    isString(value.rewardProgram, 160) &&
    isString(value.imageUrl, 500) &&
    typeof value.featured === "boolean" &&
    isString(value.summary)
  );
}

function isCardBenefits(value: Record<string, unknown>): boolean {
  return (
    isStringArray(value.benefits, 20) &&
    (value.campaignCount === undefined || isInteger(value.campaignCount, 0, 100)) &&
    (value.campaigns === undefined ||
      (Array.isArray(value.campaigns) &&
        value.campaigns.length <= 100 &&
        value.campaigns.every(isCampaign)))
  );
}

function isCreditCardList(value: unknown): value is CreditCardList {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_COLLECTION &&
    value.items.every(isCard) &&
    isPagination(value.pagination) &&
    isRecord(value.query) &&
    isOptionalString(value.query.bank, 80) &&
    isString(value.query.cardType, 80) &&
    isString(value.query.annualFee, 80) &&
    isString(value.query.network, 80) &&
    isString(value.query.sortBy, 80) &&
    isRecord(value.facets) &&
    Array.isArray(value.facets.banks) &&
    value.facets.banks.every(isFacet) &&
    isStringArray(value.facets.cardTypes, 30, 80) &&
    isStringArray(value.facets.networks, 30, 80)
  );
}

function isCreditCardDetail(value: unknown): value is CreditCardDetail {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    isCard(value.product) &&
    isStringArray(value.applicationRequirements, 20) &&
    isStringArray(value.disclosures, 20, 2_000)
  );
}

function isCreditCardCampaignList(value: unknown): value is CreditCardCampaignList {
  return (
    isRecord(value) &&
    isCard(value.card) &&
    Array.isArray(value.campaigns) &&
    value.campaigns.length <= 100 &&
    value.campaigns.every(isCampaign)
  );
}

function isFacet(value: unknown): boolean {
  return isRecord(value) && isString(value.value, 80) && isString(value.label, 160);
}
