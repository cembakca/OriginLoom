import { marketStreamMetricLines } from "@server/metrics/market-stream";
import { referralMetricLines } from "@server/metrics/referrals";
import { installRuntime, type OriginRuntime } from "@server/runtime";
import { storeBotVisit } from "@server/services/bot-analytics";
import { buildShellData } from "@server/services/shell-data";

import { isKnownPageCachePrefix } from "~/lib/cache-keys";
import type { ShellData } from "~/lib/shell-data";

import { productDocumentShell } from "./document-shell";
import { productFragments } from "./fragments";

export const productRuntime: OriginRuntime<ShellData> = {
  fragments: productFragments,
  buildShellData,
  isShellUsableForFragments: (shell) => Boolean(shell?.menu),
  document: productDocumentShell,
  cacheKeys: { isKnownPageCachePrefix },
  onBotVisit: storeBotVisit,
  metricSources: [marketStreamMetricLines, referralMetricLines],
};

export function installProductRuntime(): void {
  installRuntime(productRuntime);
}
