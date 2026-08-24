import eslintReact from "@eslint-react/eslint-plugin";
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

const browserRestrictedGlobals = {
  window: "off",
  document: "off",
  localStorage: "off",
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "eslint.config.js",
      // A consumer app cloned inside this repo for local verification owns its
      // own eslint config; linting it from here reports its rules as our failures.
      "OriginLoomSigorta/**",
    ],
  },
  eslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
      "import-x": importX,
    },
    settings: {
      "react-x": { version: "detect" },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/require-await": "off",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../*", "../../../*", "../../../../*"],
              message: "Use ~/ (src) or @server/ aliases instead of parent relative imports.",
            },
          ],
        },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./apps/showroom/server",
              from: "./apps/showroom/src/islands",
              message: "Server must not import client islands.",
            },
            {
              target: "./apps/showroom/server",
              from: "./apps/showroom/src/lib/client",
              message: "Server must not import browser-only client utilities.",
            },
            {
              target: "./apps/showroom/server",
              from: "./apps/showroom/src/lib/query",
              message: "Server must not import client query infrastructure.",
            },
            {
              target: "./apps/showroom/server",
              from: "./apps/showroom/src/lib/stores",
              message: "Server must not import client stores.",
            },
            {
              target: "./apps/showroom/server",
              from: "./apps/showroom/src/entry.client.tsx",
              message: "Server must not import client entry.",
            },
            {
              target: "./apps/showroom/src/components",
              from: "./apps/showroom/src/islands",
              message: "SSR components must not import islands directly.",
            },
            {
              target: "./apps/showroom/src/features",
              from: "./apps/showroom/src/islands",
              message: "SSR routes must not import islands directly.",
            },
            {
              target: "./apps/showroom/src/lib",
              from: "./apps/showroom/server",
              message: "apps/showroom/src/lib must not import server code.",
            },
            {
              target: "./apps/showroom/src",
              from: "./apps/showroom/server",
              message: "Shared/client source must not import server code.",
            },
            {
              target: "./apps/showroom/src/islands",
              from: "./apps/showroom/server",
              message: "Islands must not import server code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["vitest.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Workspace packages use plain relative imports; the ~/@server aliases are app-only.
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    /**
     * @originloom/shared ships into the browser bundle.
     *
     * Islands, the island runtime, the devtools panel, client telemetry and the
     * data layer all import from it, so a Node built-in reaching this package
     * does not fail here — it fails later, in whichever island first pulls the
     * module in, in a product nobody has written yet. The package is Node-free
     * today across every one of its source files; this is what keeps that a
     * property rather than a coincidence.
     *
     * `src/vite.ts` is the exception and always will be: it is build
     * configuration, read by Vite and Vitest, and never bundled for a browser.
     */
    files: ["packages/origin-shared/src/**/*.{ts,tsx}"],
    ignores: ["packages/origin-shared/src/vite.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "@originloom/shared runs in the browser too. Node built-ins belong in @originloom/core.",
            },
          ],
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["apps/showroom/server/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      "apps/showroom/tests/fixtures/gateway/**/*.js",
      "scripts/**/*.mjs",
      "packages/origin-tooling/bin/**/*.mjs",
      "packages/origin-tooling/tests/**/*.mjs",
      "apps/showroom/scripts/**/*.mjs",
      "apps/showroom/load-test/**/*.mjs",
      "apps/showroom/tests/**/*.mjs",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["apps/showroom/server/**/*.{ts,tsx}", "apps/showroom/src/**/*.{ts,tsx}"],
    ignores: ["apps/showroom/src/components/icons/generated.tsx"],
    rules: {
      "max-lines": ["warn", { max: 350, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", 18],
    },
  },
  {
    files: ["apps/showroom/tests/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      // expect(obj.method) is the standard vitest spy assertion form.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["apps/showroom/src/**/*.tsx", "apps/showroom/server/routes/**/*.tsx"],
    extends: [eslintReact.configs["recommended-typescript"]],
    // eslint-plugin-react-hooks stays the authority on hook rules; @eslint-react
    // covers the React-19-aware JSX/DOM rules that eslint-plugin-react no longer does.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@eslint-react/no-array-index-key": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute > JSXExpressionContainer > CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message:
            "Do not embed JSON.stringify output in HTML. Use serializeEmbeddedJson() so URL-like values and HTML boundaries are escaped.",
        },
      ],
    },
  },
  {
    files: ["apps/showroom/src/islands/**/*.{ts,tsx}"],
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: [
      "apps/showroom/server/routes/**/*.{ts,tsx}",
      "apps/showroom/src/features/**/*.{ts,tsx}",
      "apps/showroom/src/components/**/*.{ts,tsx}",
    ],
    ignores: ["apps/showroom/src/components/ui/**"],
    languageOptions: {
      globals: browserRestrictedGlobals,
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "Use islands for browser APIs in SSR code." },
        { name: "document", message: "Use islands for browser APIs in SSR code." },
        { name: "localStorage", message: "Use islands for browser APIs in SSR code." },
      ],
    },
  },
);
