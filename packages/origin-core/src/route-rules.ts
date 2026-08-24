import { isUnreachablePattern, matchesPath } from "@originloom/shared/lib/match";

/**
 * Policy that belongs to a path rather than to a page.
 *
 * Route policy was split in two: cache lived in the app's own registry, while
 * headers and indexing lived in middleware or in each route file — so answering
 * "what does /kasko actually send" meant reading three places and hoping none of
 * them disagreed. A rule table is the one place a path's policy is written down.
 *
 * Deliberately not a second way to declare a cache policy. `Route.cache` runs
 * before the cache key exists and can read the request; a static table cannot,
 * and having two sources for one decision is how the split started.
 */
export type RouteRule = {
  /**
   * Same pattern language as the route table: `/a/b`, `/a/:id`, `/a/:id?` and
   * `/a/:rest*`.
   *
   * `/:path*` is the one a table almost always opens with — it means this whole
   * site, `/` included, and it is how a general rule gets written before the
   * specific ones override it.
   */
  path: string;
  headers: Record<string, string>;
};

/**
 * Headers a rule may not set, and why.
 *
 * `cache-control` and `set-cookie` are decided per response by machinery that
 * knows things a path pattern cannot — whether this render was a submission,
 * whether cookies were minted, whether preview downgraded the policy. A static
 * table overriding them would silently undo those decisions, and the failure
 * would look like a caching bug rather than a rule.
 *
 * `content-type` is the response's own description of its bytes.
 */
const PROTECTED_HEADERS = new Set(["cache-control", "set-cookie", "content-type"]);

/**
 * Applies every matching rule, in order.
 *
 * Later rules win, so a table reads most-general first — the same direction a
 * stylesheet reads, and the opposite of the route table's first-match-wins,
 * which is why this does not reuse `match`.
 */
export function applyRouteRules(
  response: Response,
  pathname: string,
  rules: readonly RouteRule[],
): Response {
  const applicable = rules.filter((rule) => matchesPath(rule.path, pathname));
  if (applicable.length === 0) return response;

  const headers = new Headers(response.headers);
  let changed = false;
  for (const rule of applicable) {
    for (const [name, value] of Object.entries(rule.headers)) {
      if (PROTECTED_HEADERS.has(name.toLowerCase())) continue;
      headers.set(name, value);
      changed = true;
    }
  }
  if (!changed) return response;

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The names a rule tried to set and was refused, for a startup warning. */
export function refusedRuleHeaders(rules: readonly RouteRule[]): string[] {
  const refused = new Set<string>();
  for (const rule of rules) {
    for (const name of Object.keys(rule.headers)) {
      if (PROTECTED_HEADERS.has(name.toLowerCase())) refused.add(name.toLowerCase());
    }
  }
  return [...refused].sort();
}

/**
 * The patterns that can never match, for the same startup warning.
 *
 * Both apps opened their table with `/:path*` while the matcher still read it
 * as an ordinary one-segment parameter, so the general rule applied to exactly
 * the paths nobody meant and to neither `/` nor anything deeper. Nothing said
 * so. A rule that cannot fire is as much a mistake in the table as a header
 * that cannot be set, and it deserves the same noise.
 */
export function invalidRulePatterns(rules: readonly RouteRule[]): string[] {
  const invalid = new Set<string>();
  for (const rule of rules) {
    if (isUnreachablePattern(rule.path)) invalid.add(rule.path);
  }
  return [...invalid].sort();
}
