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

export type HousingLoanDetail = { product: HousingLoan; disclosures: string[] };

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
  product: CreditCard & { campaigns: CreditCardCampaign[] };
  applicationRequirements: string[];
  disclosures: string[];
};

export type ReferralProduct = {
  id: string;
  slug: string;
  productType: "housing-loan" | "credit-card";
  name: string;
  bank: ProductBank;
};

export type ReferralDetail = {
  product: ReferralProduct;
  disclosure: string;
  consentRequired: boolean;
};
