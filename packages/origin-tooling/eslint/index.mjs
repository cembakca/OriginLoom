import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

import { noDirectGatewayImport } from "./no-direct-gateway-import.mjs";

/**
 * The lint rules every OriginLoom product app shares.
 *
 * Shipped rather than generated. A generated config is a copy, and a copy
 * diverges: the reference app grew a rule that the product app never got,
 * because nothing connected the two after the first `create-app`. That is not a
 * hypothetical — the gateway seam rule below went missing from a real product
 * for months and nobody could have noticed, since a rule that is absent fails
 * nothing.
 *
 * What stays app-owned is anything about *this* product: which directories are
 * ignored, which globals a fixture script gets, a convention only this app has.
 * Those are appended after the preset, and a later config wins.
 */
export function originLoomEslintConfig(options = {}) {
  const { gatewaySeam = true } = options;
  return tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      // Tool configs that have to stay CommonJS (SVGR reads .cjs with require).
      files: ["**/*.cjs"],
      languageOptions: { sourceType: "commonjs", globals: globals.node },
    },
    {
      files: ["**/*.{ts,tsx}"],
      plugins: {
        "simple-import-sort": simpleImportSort,
        originloom: { rules: { "no-direct-gateway-import": noDirectGatewayImport } },
      },
      rules: {
        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
        // Ambient module augmentation (e.g. the ssr-fragment JSX typing) needs a namespace.
        "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        ...(gatewaySeam ? { "originloom/no-direct-gateway-import": "error" } : {}),
      },
    },
    // The gateway seam exists so SSR_DIAGNOSTICS sees every upstream call — a
    // runtime concern. A test that replaces the core module has to name it, and
    // no test serves traffic, so the rule has nothing to protect there.
    { files: ["tests/**/*.{ts,tsx}"], rules: { "originloom/no-direct-gateway-import": "off" } },
    prettier,
  );
}

export { noDirectGatewayImport };
