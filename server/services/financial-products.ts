import { gatewayFetch } from "@server/adapters/gateway";
import { readGatewayJson, requireGatewayPayload } from "@server/gateway-payload";
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
  BankDetail,
  BankProfile,
  CreditCard,
  CreditCardCampaign,
  CreditCardCampaignList,
  CreditCardDetail,
  CreditCardList,
  CreditCardComparison,
  HousingLoan,
  HousingLoanDetail,
  HousingLoanList,
  LoanCalculatorData,
  LoanPaymentRow,
  ProductBank,
  ReferralCreated,
  ReferralDetail,
  ReferralStats,
} from "~/lib/contracts/financial-products";

const INVALID_FINANCE = "Finance gateway returned an invalid payload";

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

function isBankProfile(value: unknown): value is BankProfile {
  if (!isRecord(value) || !isBank(value)) return false;
  const profile = value as Record<string, unknown>;
  return (
    isString(profile.description) &&
    isInteger(profile.foundedYear, 1800, 2100) &&
    isString(profile.headquarters, 160) &&
    isString(profile.websiteUrl, 500) &&
    isStringArray(profile.customerChannels, 20, 160)
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

function isLoanCalculatorData(value: unknown): value is LoanCalculatorData {
  if (
    !isRecord(value) ||
    !isRecord(value.input) ||
    !isRecord(value.constraints) ||
    !isRecord(value.result)
  )
    return false;
  const constraints = value.constraints;
  return (
    isSeoInfo(value.seoInfo) &&
    isString(value.calculationVersion, 80) &&
    value.input.productType === "housing-loan" &&
    isNumber(value.input.amount, 100_000, 10_000_000) &&
    isInteger(value.input.term, 12, 120) &&
    isNumber(value.input.monthlyInterestRate, 0.01, 20) &&
    isCalculatorConstraints(constraints) &&
    isNumber(value.result.monthlyPayment, 0, Number.MAX_SAFE_INTEGER) &&
    isNumber(value.result.totalPayment, 0, Number.MAX_SAFE_INTEGER) &&
    isNumber(value.result.totalInterest, 0, Number.MAX_SAFE_INTEGER) &&
    Array.isArray(value.result.paymentPlan) &&
    value.result.paymentPlan.length === value.input.term &&
    value.result.paymentPlan.every(isLoanPaymentRow) &&
    isString(value.disclosure, 2_000)
  );
}

function isCalculatorConstraints(value: Record<string, unknown>): boolean {
  if (!isRecord(value.amount) || !isRecord(value.term) || !isRecord(value.monthlyInterestRate))
    return false;
  return (
    isNumber(value.amount.min, 0) &&
    isNumber(value.amount.max, value.amount.min as number) &&
    isNumber(value.amount.step, 1) &&
    Array.isArray(value.term.options) &&
    value.term.options.length <= 30 &&
    value.term.options.every((term) => isInteger(term, 1, 600)) &&
    isNumber(value.monthlyInterestRate.min, 0) &&
    isNumber(value.monthlyInterestRate.max, value.monthlyInterestRate.min as number) &&
    isNumber(value.monthlyInterestRate.step, 0)
  );
}

function isLoanPaymentRow(value: unknown): value is LoanPaymentRow {
  return (
    isRecord(value) &&
    isInteger(value.installment, 1, 600) &&
    isNumber(value.principal, 0, Number.MAX_SAFE_INTEGER) &&
    isNumber(value.interest, 0, Number.MAX_SAFE_INTEGER) &&
    isNumber(value.payment, 0, Number.MAX_SAFE_INTEGER) &&
    isNumber(value.remainingPrincipal, 0, Number.MAX_SAFE_INTEGER)
  );
}

function isCreditCardComparison(value: unknown): value is CreditCardComparison {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    Array.isArray(value.products) &&
    value.products.length >= 2 &&
    value.products.length <= 3 &&
    value.products.every(isCard) &&
    isStringArray(value.requestedSlugs, 3, 120) &&
    value.requestedSlugs.length === value.products.length &&
    Array.isArray(value.availableProducts) &&
    value.availableProducts.length <= MAX_COLLECTION &&
    value.availableProducts.every(isComparisonOption)
  );
}

function isComparisonOption(value: unknown): boolean {
  return (
    isRecord(value) && isString(value.slug, 120) && isString(value.name, 240) && isBank(value.bank)
  );
}

function isBankDetail(value: unknown): value is BankDetail {
  if (!isRecord(value) || !isRecord(value.bank) || !isRecord(value.products)) return false;
  return (
    isSeoInfo(value.seoInfo) &&
    isBankProfile(value.bank) &&
    Array.isArray(value.products.housingLoans) &&
    value.products.housingLoans.length <= MAX_COLLECTION &&
    value.products.housingLoans.every(isLoan) &&
    Array.isArray(value.products.creditCards) &&
    value.products.creditCards.length <= MAX_COLLECTION &&
    value.products.creditCards.every(isCard) &&
    isStringArray(value.highlights, 20, 240) &&
    isStringArray(value.disclosures, 20, 2_000)
  );
}

function isReferralDetail(value: unknown): value is ReferralDetail {
  if (!isRecord(value) || !isRecord(value.product)) return false;
  return (
    isSeoInfo(value.seoInfo) &&
    isString(value.product.id, 120) &&
    isString(value.product.slug, 120) &&
    isString(value.product.productType, 80) &&
    isString(value.product.name, 240) &&
    isBank(value.product.bank) &&
    isString(value.disclosure, 2_000) &&
    typeof value.consentRequired === "boolean"
  );
}

function isReferralCreated(value: unknown): value is ReferralCreated {
  return (
    isRecord(value) &&
    isString(value.referralId, 160) &&
    isRecord(value.product) &&
    isString(value.product.id, 120) &&
    isString(value.product.slug, 120) &&
    isString(value.product.productType, 80) &&
    isString(value.product.name, 240) &&
    isBank(value.product.bank) &&
    isString(value.redirectUrl, 2_048) &&
    isString(value.expiresAt, 64) &&
    isRecord(value.measurement) &&
    value.measurement.event === "redirect-issued" &&
    isString(value.measurement.issuedAt, 64) &&
    isNumber(value.measurement.gatewayProcessingMs, 0, 60_000)
  );
}

function isReferralStats(value: unknown): value is ReferralStats {
  return (
    isRecord(value) &&
    isString(value.generatedAt, 64) &&
    value.measurement === "redirect-issued" &&
    Array.isArray(value.products) &&
    value.products.length <= MAX_COLLECTION &&
    value.products.every(isReferralStat)
  );
}

function isReferralStat(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.productType, 80) &&
    isString(value.slug, 120) &&
    isString(value.name, 240) &&
    isString(value.bank, 160) &&
    isInteger(value.redirectIssued, 0, Number.MAX_SAFE_INTEGER) &&
    isInteger(value.uniqueSessions, 0, 50_000) &&
    isRecord(value.latency) &&
    isInteger(value.latency.sampleCount, 0, 1_000) &&
    isNumber(value.latency.averageMs, 0, 60_000) &&
    isNumber(value.latency.p95Ms, 0, 60_000) &&
    isNumber(value.latency.maxMs, 0, 60_000) &&
    (value.lastIssuedAt === null || isString(value.lastIssuedAt, 64))
  );
}

function isFacet(value: unknown): boolean {
  return isRecord(value) && isString(value.value, 80) && isString(value.label, 160);
}
