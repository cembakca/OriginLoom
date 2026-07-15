export type Offer = { id: string; bank: string; rate: number; monthly: number };

const BANKS = ["Ziraat", "İş Bankası", "Garanti BBVA", "Akbank", "Yapı Kredi", "QNB"];

/** Stand-in for your real API call. Replace the body, keep the signature. */
export async function getOffers(q: {
  amount: number;
  city: string;
  device: string;
}): Promise<Offer[]> {
  await new Promise((r) => setTimeout(r, 15));
  return BANKS.map((bank, i) => {
    const rate = 3.29 + i * 0.17;
    return {
      id: `${bank}-${q.amount}`,
      bank,
      rate,
      monthly: Math.round((q.amount * (1 + (rate / 100) * 36)) / 36),
    };
  });
}
