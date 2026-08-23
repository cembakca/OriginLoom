/**
 * The one place this app is allowed to turn a string into markup.
 *
 * `Content-Security-Policy: require-trusted-types-for 'script'` makes the DOM
 * refuse plain strings at its injection sinks — `innerHTML` and friends — and
 * accept only values a named policy produced. That closes the half of XSS that
 * `script-src` cannot see: a nonce says which *scripts* may run, and says
 * nothing about markup assembled at runtime and assigned to an element.
 *
 * Narrowing the sink to one function is most of the value even before the
 * browser enforces anything. Every string that becomes markup passes through
 * here, so "where could markup come from?" has one answer instead of however
 * many `innerHTML` assignments the codebase happens to contain.
 *
 * The policy does not sanitize. It marks HTML the server produced as trusted,
 * and that is exactly the claim being made — the escaping happened where the
 * markup was rendered. Anything from another origin, or assembled from user
 * input in the browser, must not be passed here.
 */
const POLICY_NAME = "originloom";

type TrustedHtml = { toString(): string };
type Policy = { createHTML: (input: string) => TrustedHtml };

let policy: Policy | null | undefined;

/**
 * Resolves the policy once.
 *
 * `undefined` means not yet asked; `null` means this browser has no Trusted
 * Types, which is the normal case in Safari and anywhere the header is absent.
 * Both fall back to the plain string, which the DOM accepts when nothing is
 * enforcing.
 */
function resolvePolicy(): Policy | null {
  if (policy !== undefined) return policy;

  const trustedTypes = (globalThis as { trustedTypes?: { createPolicy?: unknown } }).trustedTypes;
  if (!trustedTypes || typeof trustedTypes.createPolicy !== "function") {
    policy = null;
    return policy;
  }

  try {
    const create = trustedTypes.createPolicy as (name: string, rules: Policy) => Policy;
    policy = create(POLICY_NAME, { createHTML: (input: string) => input });
  } catch {
    // Creating a policy throws when the name is not allow-listed by the
    // `trusted-types` directive. Failing closed here would blank the page, so
    // this degrades to the untrusted path and lets the browser decide.
    policy = null;
  }
  return policy;
}

/**
 * Marks server-rendered markup as trusted, for assignment to a DOM sink.
 *
 * Returns a `TrustedHTML` where the browser supports it and the original string
 * everywhere else, so the caller assigns the result either way.
 */
export function trustedServerHtml(html: string): string {
  const resolved = resolvePolicy();
  return (resolved ? resolved.createHTML(html) : html) as unknown as string;
}

/** Test seam: forgets the resolved policy so a case can install its own. */
export function resetTrustedTypesPolicyForTests(): void {
  policy = undefined;
}
