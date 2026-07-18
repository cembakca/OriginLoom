import {
  calculateHousingLoanOffer,
  creditCardCampaigns,
  creditCards,
  housingLoans,
} from "../data/financial-products.js";
import {
  enumParam,
  matchesQuery,
  normalizedQuery,
  numberParam,
  paginate,
  parsePage,
  parsePageSize,
} from "../lib/query.js";
import { recordReferralIssued, referralStatsSnapshot } from "../lib/referral-analytics.js";

const housingSorts = new Set([
  "recommended",
  "interest-rate-asc",
  "monthly-payment-asc",
  "total-payment-asc",
]);
const cardSorts = new Set(["recommended", "annual-fee-asc", "campaign-count-desc"]);
const cardTypes = new Set(["classic", "premium", "student", "no-fee", "digital"]);

export async function resolveFinanceRequest(request, url, readJson) {
  if (request.method === "GET" && url.pathname === "/finance/housing-loans") {
    return { status: 200, body: housingLoanList(url.searchParams) };
  }
  if (request.method === "GET" && url.pathname === "/finance/credit-cards") {
    return { status: 200, body: creditCardList(url.searchParams) };
  }
  if (request.method === "GET" && url.pathname === "/finance/referrals/stats") {
    return { status: 200, body: referralStatsSnapshot() };
  }

  const housingSlug = pathSlug(url.pathname, "/finance/housing-loans/");
  if (request.method === "GET" && housingSlug) {
    const product = housingLoans.find((item) => item.slug === housingSlug);
    if (!product) return notFound("housing loan");
    const amount = numberParam(url.searchParams, "amount", 2_000_000, 100_000, product.maxAmount);
    const requestedTerm = numberParam(url.searchParams, "term", 120, 12, 120);
    const term = product.terms.includes(requestedTerm) ? requestedTerm : 120;
    return {
      status: 200,
      body: {
        product: calculateHousingLoanOffer(product, amount, term),
        disclosures: [
          "Hesaplama örnek amaçlıdır; kesin oran ve masraflar banka değerlendirmesiyle belirlenir.",
          "Kredi tutarı ekspertiz değeri ve yasal kredi-değer sınırlarıyla değişebilir.",
        ],
      },
    };
  }

  const campaignSlug = pathSlug(url.pathname, "/finance/credit-cards/", "/campaigns");
  if (request.method === "GET" && campaignSlug) {
    const card = creditCards.find((item) => item.slug === campaignSlug);
    return card
      ? { status: 200, body: { card: summaryCard(card), campaigns: campaignsFor(card.slug) } }
      : notFound("credit card");
  }

  const cardSlug = pathSlug(url.pathname, "/finance/credit-cards/");
  if (request.method === "GET" && cardSlug) {
    const card = creditCards.find((item) => item.slug === cardSlug);
    return card
      ? {
          status: 200,
          body: {
            product: { ...card, campaigns: campaignsFor(card.slug) },
            applicationRequirements: [
              "18 yaşını doldurmuş olmak",
              "Gelirin banka tarafından doğrulanabilmesi",
              "Banka kredi politikalarına uygun değerlendirme sonucu",
            ],
            disclosures: [
              "Kampanya koşulları ve tarihler banka tarafından değiştirilebilir.",
              "Kart limiti gelir ve risk değerlendirmesi sonucunda belirlenir.",
            ],
          },
        }
      : notFound("credit card");
  }

  const referralPath = url.pathname.startsWith("/finance/referrals/")
    ? url.pathname.slice("/finance/referrals/".length).replace(/^\/+|\/+$/g, "")
    : null;
  if (request.method === "GET" && referralPath) return referralDetail(referralPath);
  if (request.method === "POST" && url.pathname === "/finance/referrals") {
    return createReferral(await readJson(request));
  }
  return null;
}

function housingLoanList(searchParams) {
  const amount = numberParam(searchParams, "amount", 2_000_000, 100_000, 10_000_000);
  const requestedTerm = numberParam(searchParams, "term", 120, 12, 120);
  const term = [12, 24, 36, 48, 60, 84, 120].includes(requestedTerm) ? requestedTerm : 120;
  const bank = normalizedQuery(searchParams.get("bank"));
  const query = normalizedQuery(searchParams.get("q"));
  const sortBy = enumParam(searchParams, "sortBy", housingSorts, "recommended");
  const city = enumParam(
    searchParams,
    "city",
    new Set(["istanbul", "ankara", "izmir", "bursa", "antalya"]),
    "istanbul",
  );
  const filtered = housingLoans
    .filter((item) => !bank || item.bank.slug === bank)
    .filter((item) => amount >= item.minAmount && amount <= item.maxAmount)
    .filter((item) => matchesQuery(query, item.name, item.bank.name, item.summary))
    .map((item) => calculateHousingLoanOffer(item, amount, item.terms.includes(term) ? term : 120));
  sortHousingLoans(filtered, sortBy);
  return {
    ...paginate(filtered, parsePage(searchParams), parsePageSize(searchParams, 6)),
    query: { amount, term, city, bank: bank || null, sortBy },
    facets: {
      banks: facet(housingLoans.map((item) => [item.bank.slug, item.bank.name])),
      terms: [12, 24, 36, 48, 60, 84, 120],
      cities: ["istanbul", "ankara", "izmir", "bursa", "antalya"],
    },
  };
}

function creditCardList(searchParams) {
  const bank = normalizedQuery(searchParams.get("bank"));
  const query = normalizedQuery(searchParams.get("q"));
  const cardType = enumParam(searchParams, "cardType", cardTypes, "all");
  const fee = enumParam(searchParams, "annualFee", new Set(["all", "free", "paid"]), "all");
  const network = enumParam(
    searchParams,
    "network",
    new Set(["all", "Visa", "Mastercard", "TROY"]),
    "all",
  );
  const sortBy = enumParam(searchParams, "sortBy", cardSorts, "recommended");
  const filtered = creditCards
    .filter((item) => !bank || item.bank.slug === bank)
    .filter((item) => cardType === "all" || item.cardType === cardType)
    .filter((item) => fee === "all" || (fee === "free" ? item.annualFee === 0 : item.annualFee > 0))
    .filter((item) => network === "all" || item.network === network)
    .filter((item) => matchesQuery(query, item.name, item.bank.name, item.summary))
    .map((item) => summaryCard(item));
  sortCards(filtered, sortBy);
  return {
    ...paginate(filtered, parsePage(searchParams), parsePageSize(searchParams, 8)),
    query: { bank: bank || null, cardType, annualFee: fee, network, sortBy },
    facets: {
      banks: facet(creditCards.map((item) => [item.bank.slug, item.bank.name])),
      cardTypes: [...cardTypes],
      networks: ["Visa", "Mastercard", "TROY"],
    },
  };
}

function summaryCard(card) {
  return { ...card, campaignCount: campaignsFor(card.slug).length };
}

function campaignsFor(slug) {
  return creditCardCampaigns[slug] ?? [];
}

function sortHousingLoans(items, sortBy) {
  if (sortBy === "interest-rate-asc") items.sort((a, b) => a.interestRate - b.interestRate);
  else if (sortBy === "monthly-payment-asc") {
    items.sort((a, b) => a.calculation.monthlyPayment - b.calculation.monthlyPayment);
  } else if (sortBy === "total-payment-asc") {
    items.sort((a, b) => a.calculation.totalPayment - b.calculation.totalPayment);
  } else items.sort((a, b) => Number(b.featured) - Number(a.featured));
}

function sortCards(items, sortBy) {
  if (sortBy === "annual-fee-asc") items.sort((a, b) => a.annualFee - b.annualFee);
  else if (sortBy === "campaign-count-desc") {
    items.sort((a, b) => b.campaignCount - a.campaignCount);
  } else items.sort((a, b) => Number(b.featured) - Number(a.featured));
}

function referralDetail(path) {
  const [productType, slug, extra] = path.split("/");
  if (extra || !productType || !slug) return notFound("referral product");
  const product = findProduct(productType, slug);
  return product
    ? {
        status: 200,
        body: {
          product: referralProduct(product),
          disclosure: "Başvurunuz seçtiğiniz bankanın güvenli başvuru kanalında tamamlanacaktır.",
          consentRequired: false,
        },
      }
    : notFound("referral product");
}

function createReferral(body) {
  const started = performance.now();
  const productType = typeof body.productType === "string" ? body.productType : "";
  const slug = typeof body.slug === "string" ? body.slug : "";
  const anonymousSessionId = validAnonymousSessionId(body.anonymousSessionId)
    ? body.anonymousSessionId
    : null;
  const product = findProduct(productType, slug);
  if (!product) return { status: 400, body: { error: "unknown referral product" } };
  const referralId = `ref-${crypto.randomUUID()}`;
  const gatewayProcessingMs = performance.now() - started;
  recordReferralIssued(product, anonymousSessionId, gatewayProcessingMs);
  return {
    status: 201,
    body: {
      referralId,
      product: referralProduct(product),
      redirectUrl: `https://application.example-bank.test/start?ref=${encodeURIComponent(referralId)}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      measurement: {
        event: "redirect-issued",
        issuedAt: new Date().toISOString(),
        gatewayProcessingMs: Number(gatewayProcessingMs.toFixed(3)),
      },
    },
  };
}

function findProduct(productType, slug) {
  return referralProductResolvers.get(productType)?.(slug);
}

const referralProductResolvers = new Map([
  ["housing-loan", (slug) => housingLoans.find((item) => item.slug === slug)],
  ["credit-card", (slug) => creditCards.find((item) => item.slug === slug)],
]);

function validAnonymousSessionId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value);
}

function referralProduct(product) {
  return {
    id: product.id,
    slug: product.slug,
    productType: product.productType,
    name: product.name,
    bank: product.bank,
  };
}

function facet(entries) {
  return [...new Map(entries).entries()].map(([value, label]) => ({ value, label }));
}

function pathSlug(pathname, prefix, suffix = "") {
  if (!pathname.startsWith(prefix) || (suffix && !pathname.endsWith(suffix))) return null;
  const end = suffix ? -suffix.length : undefined;
  const value = pathname.slice(prefix.length, end).replace(/^\/+|\/+$/g, "");
  return value && !value.includes("/") ? value : null;
}

function notFound(resource) {
  return { status: 404, body: { error: `${resource} not found` } };
}
