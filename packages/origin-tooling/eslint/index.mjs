import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The lint rules every OriginLoom product app shares.
 *
 * Shipped rather than generated. A generated config is a copy, and a copy
 * diverges: a rule the reference app grew never reaches the product app,
 * because nothing connects the two after the first `create-app` — and a rule
 * that is absent fails nothing, so nobody notices.
 *
 * What stays app-owned is anything about *this* product: which directories are
 * ignored, which globals a fixture script gets, a convention only this app has.
 * Those are appended after the preset, and a later config wins.
 */
export function originLoomEslintConfig() {
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
      plugins: { "simple-import-sort": simpleImportSort },
      rules: {
        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
        // Ambient module augmentation (e.g. the ssr-fragment JSX typing) needs a namespace.
        "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
      },
    },
    prettier,
  );
}
