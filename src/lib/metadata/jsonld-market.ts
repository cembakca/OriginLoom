import type { Stock } from "~/lib/contracts/markets";

import type { JsonLdObject } from "./jsonld";

export function stockItemListJsonLd(stocks: Stock[]): JsonLdObject | null {
  if (stocks.length === 0) return null;
  return {
    "@type": "ItemList",
    name: "BIST 100 hisseleri",
    numberOfItems: stocks.length,
    itemListElement: stocks.map((stock, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Corporation",
        name: stock.name,
        tickerSymbol: stock.symbol,
      },
    })),
  };
}
