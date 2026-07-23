import { cspScriptHash, registerCspScriptHashes } from "@originloom/core/middleware/security";
import { installRuntime, type OriginRuntime } from "@originloom/core/runtime";
import { marketStreamMetricLines } from "@server/metrics/market-stream";
import { referralMetricLines } from "@server/metrics/referrals";
import { storeBotVisit } from "@server/services/bot-analytics";
import { buildShellData } from "@server/services/shell-data";

import {
  buildEventQueueScript,
  buildGtmScript,
  EARLY_TRACKING_SCRIPT,
} from "~/components/analytics/gtm-bootstrap";
import { isKnownPageCachePrefix } from "~/lib/cache-keys";
import type { ShellData } from "~/lib/shell-data";

import { productConfig } from "./config";
import { productDocumentShell } from "./document-shell";
import { productFragments } from "./fragments";

// CSP hashes for the product's inline scripts (no-op outside production).
registerCspScriptHashes(
  cspScriptHash("window.dataLayer=window.dataLayer||[];"),
  cspScriptHash(buildEventQueueScript()),
  cspScriptHash(EARLY_TRACKING_SCRIPT),
);
if (productConfig.gtmContainerId) {
  registerCspScriptHashes(cspScriptHash(buildGtmScript(productConfig.gtmContainerId)));
}

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
