/**
 * Every upstream call goes through `@server/diagnostics/gateway`.
 *
 * That module is a transparent pass-through to the platform adapter which, when
 * `SSR_DIAGNOSTICS=1`, times each call and attributes it to the request that
 * made it. A service that imports `@originloom/core/adapters/gateway` directly
 * still works — which is exactly the problem: it silently drops out of every
 * trace, and nothing fails until someone is debugging a slow page at 3am and
 * finds a gap where the call should be.
 *
 * The adapter itself is the one file allowed to reach for core.
 */
const CORE_ADAPTER = "@originloom/core/adapters/gateway";
const APP_ADAPTER = "@server/diagnostics/gateway";
const ADAPTER_FILE = /(^|\/)server\/diagnostics\/gateway\.ts$/;

/** @type {import("eslint").Rule.RuleModule} */
export const noDirectGatewayImport = {
  meta: {
    type: "problem",
    docs: {
      description: "Import the gateway from the app adapter so diagnostics can see the call.",
    },
    messages: {
      direct: `Import the gateway from "${APP_ADAPTER}", not "${CORE_ADAPTER}" — a direct import is invisible to SSR_DIAGNOSTICS.`,
    },
    fixable: "code",
    schema: [],
  },

  create(context) {
    // Posix-normalized so the exemption also matches on Windows checkouts.
    const filename = (context.filename ?? "").replaceAll("\\", "/");
    if (ADAPTER_FILE.test(filename)) return {};

    /** @param {{ value: unknown }} source */
    const check = (source) => {
      if (!source || source.value !== CORE_ADAPTER) return;
      context.report({
        node: source,
        messageId: "direct",
        fix: (fixer) => fixer.replaceText(source, JSON.stringify(APP_ADAPTER)),
      });
    };

    return {
      // `import … from`, `export … from`, `export * from` and `await import()`
      // all reach the same module; a rule that only knew the first would be a
      // rule anyone could route around by accident.
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};
