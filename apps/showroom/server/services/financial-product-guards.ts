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
} from "~/lib/contracts/financial-products";

/**
 * Runtime shape checks for what the finance gateway returns. They live apart
 * from the calls because they answer a different question: the calls decide
 * where data comes from, these decide whether to believe it. Gateway JSON is
 * untrusted input, and a TypeScript type is not a check.
 */
export function isBank(value: unknown): value is ProductBank {
  return (
    isRecord(value) &&
    isString(value.slug, 80) &&
    isString(value.name, 160) &&
    isString(value.logoUrl, 500)
  );
}

export function isLoan(value: unknown): value is HousingLoan {
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

/** Split along the payload's own parts, so a failure points at the part that is wrong. */
export function isHousingLoanList(value: unknown): value is HousingLoanList {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    isLoanCollection(value.items) &&
    isPagination(value.pagination) &&
    isLoanQuery(value.query) &&
    isLoanFacets(value.facets)
  );
}

function isLoanCollection(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_COLLECTION && value.every(isLoan);
}

/** The search the upstream echoes back, not a search we asked it to run. */
function isLoanQuery(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.amount) &&
    isInteger(value.term, 1, 600) &&
    isString(value.city, 80) &&
    isOptionalString(value.bank, 80) &&
    isString(value.sortBy, 80)
  );
}

function isLoanFacets(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.banks) &&
    value.banks.length <= MAX_COLLECTION &&
    value.banks.every(isFacet) &&
    Array.isArray(value.terms) &&
    value.terms.every((term) => isInteger(term, 1, 600)) &&
    isStringArray(value.cities, 50, 80)
  );
}

export function isHousingLoanDetail(value: unknown): value is HousingLoanDetail {
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

export function isCard(value: unknown): value is CreditCard {
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

export function isCreditCardList(value: unknown): value is CreditCardList {
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

export function isCreditCardDetail(value: unknown): value is CreditCardDetail {
  return (
    isRecord(value) &&
    isSeoInfo(value.seoInfo) &&
    isCard(value.product) &&
    isStringArray(value.applicationRequirements, 20) &&
    isStringArray(value.disclosures, 20, 2_000)
  );
}

export function isCreditCardCampaignList(value: unknown): value is CreditCardCampaignList {
  return (
    isRecord(value) &&
    isCard(value.card) &&
    Array.isArray(value.campaigns) &&
    value.campaigns.length <= 100 &&
    value.campaigns.every(isCampaign)
  );
}

export function isFacet(value: unknown): boolean {
  return isRecord(value) && isString(value.value, 80) && isString(value.label, 160);
}
