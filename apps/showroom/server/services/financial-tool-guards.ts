import {
  isInteger,
  isNumber,
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
  CreditCardComparison,
  HousingLoan,
  LoanCalculatorData,
  LoanPaymentRow,
  ProductBank,
} from "~/lib/contracts/financial-products";

type ProductGuards = {
  isBank: (value: unknown) => value is ProductBank;
  isLoan: (value: unknown) => value is HousingLoan;
  isCard: (value: unknown) => value is CreditCard;
};

export function createFinancialToolGuards({ isBank, isLoan, isCard }: ProductGuards) {
  function isLoanCalculatorData(value: unknown): value is LoanCalculatorData {
    if (
      !isRecord(value) ||
      !isRecord(value.input) ||
      !isRecord(value.constraints) ||
      !isRecord(value.result)
    )
      return false;
    return (
      isSeoInfo(value.seoInfo) &&
      isString(value.calculationVersion, 80) &&
      value.input.productType === "housing-loan" &&
      isNumber(value.input.amount, 100_000, 10_000_000) &&
      isInteger(value.input.term, 12, 120) &&
      isNumber(value.input.monthlyInterestRate, 0.01, 20) &&
      isCalculatorConstraints(value.constraints) &&
      isNumber(value.result.monthlyPayment, 0, Number.MAX_SAFE_INTEGER) &&
      isNumber(value.result.totalPayment, 0, Number.MAX_SAFE_INTEGER) &&
      isNumber(value.result.totalInterest, 0, Number.MAX_SAFE_INTEGER) &&
      Array.isArray(value.result.paymentPlan) &&
      value.result.paymentPlan.length === value.input.term &&
      value.result.paymentPlan.every(isLoanPaymentRow) &&
      isString(value.disclosure, 2_000)
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
      isRecord(value) &&
      isString(value.slug, 120) &&
      isString(value.name, 240) &&
      isBank(value.bank)
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

  function isBankProfile(value: unknown): value is BankProfile {
    if (!isRecord(value) || !isBank(value)) return false;
    const profile = value as Record<string, unknown>;
    return (
      isString(profile.description) &&
      isInteger(profile.foundedYear, 1800, 2100) &&
      isString(profile.headquarters, 160) &&
      isHttpsUrl(profile.websiteUrl) &&
      isStringArray(profile.customerChannels, 20, 160)
    );
  }

  return { isBankDetail, isCreditCardComparison, isLoanCalculatorData };
}

function isCalculatorConstraints(value: Record<string, unknown>): boolean {
  if (!isRecord(value.amount) || !isRecord(value.term) || !isRecord(value.monthlyInterestRate))
    return false;
  return (
    isNumber(value.amount.min, 0) &&
    isNumber(value.amount.max, value.amount.min) &&
    isNumber(value.amount.step, 1) &&
    Array.isArray(value.term.options) &&
    value.term.options.length <= 30 &&
    value.term.options.every((term) => isInteger(term, 1, 600)) &&
    isNumber(value.monthlyInterestRate.min, 0) &&
    isNumber(value.monthlyInterestRate.max, value.monthlyInterestRate.min) &&
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

function isHttpsUrl(value: unknown): value is string {
  if (!isString(value, 500)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
