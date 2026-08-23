import type { ServerIslandRegistry } from "@originloom/core/server-island";
import { renderToStaticMarkup } from "react-dom/server";

import { VisitorSummary } from "~/features/server-island/visitor-summary";
import { readVisitorFacts } from "~/lib/visitor-facts";

/**
 * Islands the server renders on demand, after the cached shell has gone out.
 *
 * Everything personal is read from `context.request` here — the placeholder in
 * the cached HTML is identical for every visitor, so this is the only place a
 * per-person fact can come from.
 *
 * `renderToStaticMarkup`, not `renderToString`: the result is dropped into the
 * document as markup and never hydrated, so React's hydration bookkeeping would
 * be bytes nobody reads.
 */
export const serverIslands: ServerIslandRegistry = {
  "visitor-summary": (props, context) =>
    renderToStaticMarkup(
      <VisitorSummary
        facts={readVisitorFacts(context.request)}
        variant={(props as { variant?: "compact" | "full" } | null)?.variant ?? "full"}
      />,
    ),
};
