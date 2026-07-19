import type { SeoInfo } from "~/lib/metadata/types";

import type { FacetOption, Pagination } from "./pagination";

export type ProductBank = { slug: string; name: string; logoUrl: string };

export type LoanCalculation = {
  amount: number;
  term: number;
  monthlyPayment: number;
  totalPayment: number;
  allocationFee: number;
  appraisalFee: number;
};

export type HousingLoan = {
  id: string;
  slug: string;
  productType: "housing-loan";
  bank: ProductBank;
  name: string;
  summary: string;
  interestRate: number;
  annualCostRate: number;
  minAmount: number;
  maxAmount: number;
  terms: number[];
  allocationFeeRate: number;
  appraisalFee: number;
  maxLoanToValue: number;
  featured: boolean;
  badges: string[];
  requirements: string[];
  features: string[];
  calculation: LoanCalculation;
};

export type HousingLoanList = {
  seoInfo: SeoInfo;
  items: HousingLoan[];
  pagination: Pagination;
  query: {
    amount: number;
    term: number;
    city: string;
    bank: string | null;
    sortBy: string;
  };
  facets: { banks: FacetOption[]; terms: number[]; cities: string[] };
};

export type HousingLoanDetail = { product: HousingLoan; disclosures: string[]; seoInfo: SeoInfo };

export type CreditCardCampaign = {
  id: string;
  category: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  participation: string;
  termsUrl: string;
};

export type CreditCard = {
  id: string;
  slug: string;
  productType: "credit-card";
  bank: ProductBank;
  name: string;
  cardType: string;
  network: string;
  annualFee: number;
  minMonthlyIncome: number;
  rewardProgram: string;
  imageUrl: string;
  featured: boolean;
  summary: string;
  benefits: string[];
  campaignCount?: number;
  campaigns?: CreditCardCampaign[];
};

export type CreditCardList = {
  seoInfo: SeoInfo;
  items: CreditCard[];
  pagination: Pagination;
  query: {
    bank: string | null;
    cardType: string;
    annualFee: string;
    network: string;
    sortBy: string;
  };
  facets: { banks: FacetOption[]; cardTypes: string[]; networks: string[] };
};

export type CreditCardDetail = {
  seoInfo: SeoInfo;
  product: CreditCard;
  applicationRequirements: string[];
  disclosures: string[];
};

export type CreditCardCampaignList = {
  card: CreditCard;
  campaigns: CreditCardCampaign[];
};

export type ReferralProduct = {
  id: string;
  slug: string;
  productType: string;
  name: string;
  bank: ProductBank;
};

export type ReferralDetail = {
  seoInfo: SeoInfo;
  product: ReferralProduct;
  disclosure: string;
  consentRequired: boolean;
};

export type ReferralCreated = {
  referralId: string;
  product: ReferralProduct;
  redirectUrl: string;
  expiresAt: string;
  measurement: {
    event: "redirect-issued";
    issuedAt: string;
    gatewayProcessingMs: number;
  };
};

export type ReferralStats = {
  generatedAt: string;
  measurement: "redirect-issued";
  products: Array<{
    productType: string;
    slug: string;
    name: string;
    bank: string;
    redirectIssued: number;
    uniqueSessions: number;
    latency: { sampleCount: number; averageMs: number; p95Ms: number; maxMs: number };
    lastIssuedAt: string | null;
  }>;
};
