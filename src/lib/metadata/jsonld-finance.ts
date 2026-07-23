import type { BankProfile, CreditCard, HousingLoan } from "~/lib/contracts/financial-products";

import type { JsonLdObject } from "@originloom/react/lib/metadata/jsonld";

export function housingLoanJsonLd(product: HousingLoan, canonical: string): JsonLdObject {
  return {
    "@type": "LoanOrCredit",
    "@id": `${canonical}#financial-product`,
    mainEntityOfPage: { "@id": `${canonical}#webpage` },
    url: canonical,
    name: product.name,
    description: product.summary,
    provider: bank(product.bank.name),
    amount: moneyRange(product.minAmount, product.maxAmount),
    loanTerm: product.terms.map((term) => ({
      "@type": "QuantitativeValue",
      value: term,
      unitCode: "MON",
    })),
    interestRate: product.interestRate,
    annualPercentageRate: product.annualCostRate,
    feesAndCommissionsSpecification: `Tahsis ücreti oranı %${product.allocationFeeRate}; ekspertiz ücreti ${product.appraisalFee} TRY.`,
    requiredCollateral: `Konut; azami kredi/değer oranı %${product.maxLoanToValue}.`,
  };
}

export function creditCardJsonLd(product: CreditCard, canonical: string): JsonLdObject {
  return {
    "@type": "CreditCard",
    "@id": `${canonical}#financial-product`,
    mainEntityOfPage: { "@id": `${canonical}#webpage` },
    url: canonical,
    name: product.name,
    description: product.summary,
    image: absoluteUrl(product.imageUrl, canonical),
    provider: bank(product.bank.name),
    feesAndCommissionsSpecification:
      product.annualFee === 0
        ? "Yıllık kart ücreti yoktur."
        : `Yıllık kart ücreti ${product.annualFee} TRY.`,
    category: product.cardType,
  };
}

export function bankProfileJsonLd(profile: BankProfile, canonical: string): JsonLdObject {
  return {
    "@type": "BankOrCreditUnion",
    "@id": `${canonical}#bank`,
    mainEntityOfPage: { "@id": `${canonical}#webpage` },
    url: canonical,
    name: profile.name,
    description: profile.description,
    foundingDate: String(profile.foundedYear),
    address: {
      "@type": "PostalAddress",
      addressLocality: profile.headquarters,
      addressCountry: "TR",
    },
  };
}

function absoluteUrl(value: string, canonical: string): string {
  return new URL(value, canonical).toString();
}

function bank(name: string): JsonLdObject {
  return { "@type": "BankOrCreditUnion", name };
}

function moneyRange(minValue: number, maxValue: number): JsonLdObject {
  return {
    "@type": "MonetaryAmount",
    currency: "TRY",
    minValue,
    maxValue,
  };
}
