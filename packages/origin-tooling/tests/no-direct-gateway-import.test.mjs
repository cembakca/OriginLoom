// The rule ships in this package now, so its test does too. It used to be
// generated into every app, which meant each copy could rot on its own.
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { noDirectGatewayImport } from "../eslint/no-direct-gateway-import.mjs";

const linter = new Linter();

const config = [
  {
    // Flat config only lints the extensions a block claims. Without this the
    // linter answers "no matching configuration" for a .ts filename and the
    // rule never runs — a green test that checked nothing.
    files: ["**/*.ts"],
    plugins: { originloom: { rules: { "no-direct-gateway-import": noDirectGatewayImport } } },
    rules: { "originloom/no-direct-gateway-import": "error" },
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
  },
];

function lint(code, filename = "server/services/items.ts") {
  return linter.verify(code, config, filename);
}

function fix(code, filename = "server/services/items.ts") {
  return linter.verifyAndFix(code, config, filename).output;
}

describe("no-direct-gateway-import", () => {
  it("has a working harness — the linter must actually apply the config", () => {
    // Every assertion below is "no messages" or "this message"; a harness that
    // silently stopped linting would make half of them pass for free.
    expect(lint("const ok = 1;").map((message) => message.message)).toEqual([]);
  });

  it("flags a direct import of the platform adapter", () => {
    const [message, ...rest] = lint(
      'import { gatewayFetch } from "@originloom/core/adapters/gateway";',
    );

    expect(rest).toEqual([]);
    expect(message?.messageId).toBe("direct");
  });

  it("rewrites the specifier to the app adapter", () => {
    expect(fix('import { gatewayFetch } from "@originloom/core/adapters/gateway";')).toBe(
      'import { gatewayFetch } from "@server/diagnostics/gateway";',
    );
  });

  // A rule that only knew `import … from` would be one anyone could route
  // around without noticing, so each spelling is covered.
  it.each([
    ['export { gatewayFetch } from "@originloom/core/adapters/gateway";', "re-export"],
    ['export * from "@originloom/core/adapters/gateway";', "star re-export"],
    ['const m = await import("@originloom/core/adapters/gateway");', "dynamic import"],
  ])("flags a %s", (code) => {
    expect(lint(code).map((message) => message.messageId)).toEqual(["direct"]);
  });

  it("allows the app adapter itself to reach for core", () => {
    expect(
      lint(
        'import * as coreGateway from "@originloom/core/adapters/gateway";',
        "server/diagnostics/gateway.ts",
      ),
    ).toEqual([]);
  });

  it("leaves the app adapter and unrelated platform modules alone", () => {
    expect(
      lint(
        'import { gatewayFetch } from "@server/diagnostics/gateway";\n' +
          'import { logger } from "@originloom/core/logger";',
      ),
    ).toEqual([]);
  });

  it("matches the specifier exactly, not by prefix", () => {
    // A neighbouring module whose name merely starts the same way is a
    // different module, and flagging it would send someone to an import that
    // does not exist.
    expect(lint('import { x } from "@server/diagnostics/gateway-identity";')).toEqual([]);
  });

  it("does not flag the module name in a vi.mock call", () => {
    expect(lint('vi.mock("@originloom/core/adapters/gateway", () => ({}));')).toEqual([]);
  });
});
