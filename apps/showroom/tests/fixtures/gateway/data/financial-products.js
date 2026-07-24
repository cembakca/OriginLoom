const bankDefinitions = [
  ["ziraat", "Ziraat Bankası"],
  ["is-bankasi", "İş Bankası"],
  ["garanti-bbva", "Garanti BBVA"],
  ["akbank", "Akbank"],
  ["yapi-kredi", "Yapı Kredi"],
  ["qnb", "QNB"],
  ["denizbank", "DenizBank"],
  ["teb", "TEB"],
];

export const bankProfiles = bankDefinitions.map(([slug, name], index) => ({
  slug,
  name,
  logoUrl: `/media/banks/${slug}.svg`,
  description: `${name}, bireysel bankacılık, kart ve konut finansmanı ürünleri sunan örnek banka profilidir.`,
  foundedYear: 1863 + index * 11,
  headquarters: index % 2 === 0 ? "İstanbul" : "Ankara",
  websiteUrl: `https://www.example.com/bankalar/${slug}`,
  customerChannels: ["Mobil bankacılık", "İnternet şubesi", "Şube ve çağrı merkezi"],
}));

export const housingLoans = bankDefinitions.map(([bankSlug, bankName], index) => {
  const interestRate = Number((2.69 + index * 0.11).toFixed(2));
  return {
    id: `housing-${bankSlug}`,
    slug: `${bankSlug}-konut-kredisi`,
    productType: "housing-loan",
    bank: {
      slug: bankSlug,
      name: bankName,
      logoUrl: `/media/banks/${bankSlug}.svg`,
    },
    name: `${bankName} Konut Kredisi`,
    summary: "Yeni veya ikinci el konut alımları için ekspertiz değerine göre finansman.",
    interestRate,
    annualCostRate: Number((interestRate * 12 + 4.8 + index * 0.35).toFixed(2)),
    minAmount: 100_000,
    maxAmount: 10_000_000 - index * 250_000,
    terms: [12, 24, 36, 48, 60, 84, 120],
    allocationFeeRate: 0.5,
    appraisalFee: 18_500 + index * 750,
    maxLoanToValue: index % 3 === 0 ? 90 : 80,
    featured: index < 3,
    badges: index === 0 ? ["Öne Çıkan", "Düşük Faiz"] : index < 3 ? ["Online Başvuru"] : [],
    requirements: [
      "Düzenli ve belgelenebilir gelir",
      "Satın alınacak konut için olumlu ekspertiz raporu",
      "Kredi vadesi boyunca konut sigortası ve DASK",
    ],
    features: [
      "120 aya varan vade",
      `%${index % 3 === 0 ? 90 : 80}'a varan ekspertiz değeri finansmanı`,
      index % 2 === 0 ? "Şubeye gitmeden ön değerlendirme" : "Esnek ödeme tarihi",
    ],
  };
});

const cardDefinitions = [
  ["maximum", "İş Bankası", "is-bankasi", "Maximum Kart", "classic", "Mastercard", 1_149],
  ["bonus", "Garanti BBVA", "garanti-bbva", "Bonus Card", "classic", "Visa", 1_248],
  ["axess", "Akbank", "akbank", "Axess", "classic", "Visa", 1_080],
  ["world", "Yapı Kredi", "yapi-kredi", "Worldcard", "classic", "Mastercard", 1_140],
  ["cardfinans", "QNB", "qnb", "CardFinans", "classic", "Visa", 980],
  ["bonus-platinum", "Garanti BBVA", "garanti-bbva", "Bonus Platinum", "premium", "Visa", 1_762],
  ["maximum-genc", "İş Bankası", "is-bankasi", "Maximum Genç", "student", "TROY", 0],
  ["axess-free", "Akbank", "akbank", "Free Kart", "no-fee", "Mastercard", 0],
  ["world-eko", "Yapı Kredi", "yapi-kredi", "World Eko", "no-fee", "Visa", 0],
  ["teb-sade", "TEB", "teb", "CEPTETEB Kredi Kartı", "digital", "Mastercard", 0],
  ["denizbank-black", "DenizBank", "denizbank", "Black", "premium", "Visa", 1_920],
  ["ziraat-bankkart", "Ziraat Bankası", "ziraat", "Bankkart", "classic", "TROY", 420],
];

export const creditCards = cardDefinitions.map(
  ([slug, bankName, bankSlug, name, cardType, network, annualFee], index) => ({
    id: `card-${slug}`,
    slug,
    productType: "credit-card",
    bank: { slug: bankSlug, name: bankName, logoUrl: `/media/banks/${bankSlug}.svg` },
    name,
    cardType,
    network,
    annualFee,
    minMonthlyIncome: cardType === "premium" ? 50_000 : cardType === "student" ? 0 : 17_000,
    rewardProgram: `${name.split(" ")[0]} Puan`,
    imageUrl: "/assets/media/og-default.jpg",
    featured: index < 5,
    summary:
      annualFee === 0
        ? "Yıllık kart ücreti olmadan taksit ve puan avantajları."
        : "Günlük harcamalarda puan, seçili sektörlerde taksit ve kampanya avantajları.",
    benefits: [
      "Seçili iş yerlerinde taksit",
      "Dijital cüzdan ile temassız ödeme",
      index % 2 === 0
        ? "Market ve akaryakıt harcamalarında ek puan"
        : "E-ticaret harcamalarında indirim",
    ],
  }),
);

const campaignTemplates = [
  [
    "market",
    "Market alışverişine 500 TL puan",
    "Ay boyunca toplam 5.000 TL market harcamasına 500 TL puan.",
  ],
  [
    "akaryakit",
    "Akaryakıtta %10 iade",
    "Anlaşmalı istasyonlarda 4 işlemde toplam 400 TL'ye varan iade.",
  ],
  [
    "e-ticaret",
    "E-ticaret alışverişine 6 taksit",
    "Seçili e-ticaret markalarında vade farksız 6 taksit.",
  ],
];

export const creditCardCampaigns = Object.fromEntries(
  creditCards.map((card, cardIndex) => [
    card.slug,
    campaignTemplates
      .slice(0, 2 + (cardIndex % 2))
      .map(([category, title, description], index) => ({
        id: `${card.slug}-campaign-${index + 1}`,
        category,
        title,
        description,
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-08-31T23:59:59.000Z",
        participation: index === 0 ? "Mobil uygulamadan katılım" : "Otomatik katılım",
        termsUrl: `/bilgi-merkezi/kampanya-kosullari/${card.slug}-${category}`,
      })),
  ]),
);

export function calculateHousingLoanOffer(product, amount, term) {
  const monthlyRate = product.interestRate / 100;
  const compound = (1 + monthlyRate) ** term;
  const monthlyPayment = Math.round((amount * monthlyRate * compound) / (compound - 1));
  const allocationFee = Math.round((amount * product.allocationFeeRate) / 100);
  const totalPayment = monthlyPayment * term + allocationFee + product.appraisalFee;
  return {
    ...product,
    calculation: {
      amount,
      term,
      monthlyPayment,
      totalPayment,
      allocationFee,
      appraisalFee: product.appraisalFee,
    },
  };
}

export function calculateLoanPaymentPlan(amount, term, monthlyInterestRate) {
  const monthlyRate = monthlyInterestRate / 100;
  const compound = (1 + monthlyRate) ** term;
  const monthlyPayment = Math.round((amount * monthlyRate * compound) / (compound - 1));
  let remainingPrincipal = amount;
  const paymentPlan = [];
  for (let installment = 1; installment <= term; installment += 1) {
    const interest = Math.round(remainingPrincipal * monthlyRate);
    const principal = installment === term ? remainingPrincipal : monthlyPayment - interest;
    remainingPrincipal = Math.max(0, remainingPrincipal - principal);
    paymentPlan.push({
      installment,
      principal,
      interest,
      payment: installment === term ? principal + interest : monthlyPayment,
      remainingPrincipal,
    });
  }
  const totalPayment = paymentPlan.reduce((sum, row) => sum + row.payment, 0);
  return {
    monthlyPayment,
    totalPayment,
    totalInterest: totalPayment - amount,
    paymentPlan,
  };
}
