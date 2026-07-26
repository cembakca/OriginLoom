import type { JsonLdObject } from "@originloom/shared/lib/metadata/jsonld";

import type { Stock } from "~/lib/contracts/markets";

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
