import {
  isInteger,
  isNumber,
  isRecord,
  isString,
  MAX_COLLECTION,
} from "@server/services/gateway-guards";
import { isSeoInfo } from "@server/services/seo-info";

import type {
  ProductBank,
  ReferralCreated,
  ReferralDetail,
  ReferralStats,
} from "~/lib/contracts/financial-products";

export function createFinancialReferralGuards(isBank: (value: unknown) => value is ProductBank) {
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

  return { isReferralCreated, isReferralDetail };
}

export function isReferralStats(value: unknown): value is ReferralStats {
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
