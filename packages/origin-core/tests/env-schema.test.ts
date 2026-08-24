import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type EnvSchema,
  EnvSchemaError,
  parseEnv,
  publicEnv,
  publicEnvNames,
  secretEnvNames,
} from "../src/env-schema.js";

const schema = {
  SITE_URL: { type: "url", access: "public", required: true, description: "Public origin" },
  GATEWAY_TOKEN: { type: "string", access: "secret", required: true, description: "Upstream auth" },
  PAGE_SIZE: {
    type: "number",
    access: "public",
    default: 20,
    min: 1,
    max: 100,
    description: "Items per page",
  },
  FEATURE_X: { type: "boolean", access: "public", default: false, description: "Toggle" },
  LOG_LEVEL: {
    type: "enum",
    access: "public",
    values: ["debug", "info", "warn"] as const,
    default: "info",
    description: "Verbosity",
  },
} satisfies EnvSchema;

const complete = {
  SITE_URL: "https://example.com/",
  GATEWAY_TOKEN: "t0ken",
  PAGE_SIZE: "50",
  FEATURE_X: "yes",
  LOG_LEVEL: "warn",
};

describe("parseEnv", () => {
  it("parses each declared type rather than handing back strings", () => {
    const env = parseEnv(schema, complete, { production: true });

    expect(env.PAGE_SIZE).toBe(50);
    expect(env.FEATURE_X).toBe(true);
    expect(env.LOG_LEVEL).toBe("warn");
    // A trailing slash on an origin is the classic source of double-slash URLs.
    expect(env.SITE_URL).toBe("https://example.com");
  });

  it("applies defaults for values that are absent", () => {
    const env = parseEnv(
      schema,
      { SITE_URL: "https://x.test", GATEWAY_TOKEN: "t" },
      { production: true },
    );

    expect(env.PAGE_SIZE).toBe(20);
    expect(env.FEATURE_X).toBe(false);
    expect(env.LOG_LEVEL).toBe("info");
  });

  /**
   * One message with every problem. Failing on the first turns a misconfigured
   * deploy into a sequence of restarts, each revealing one more mistake.
   */
  it("reports every problem at once", () => {
    let error: unknown;
    try {
      parseEnv(
        schema,
        { PAGE_SIZE: "huge", FEATURE_X: "maybe", LOG_LEVEL: "loud" },
        { production: true },
      );
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(EnvSchemaError);
    const problems = (error as EnvSchemaError).problems.join("\n");
    expect(problems).toContain("SITE_URL is required");
    expect(problems).toContain("GATEWAY_TOKEN is required");
    expect(problems).toContain("PAGE_SIZE is not a number");
    expect(problems).toContain("FEATURE_X is not a boolean");
    expect(problems).toContain("LOG_LEVEL must be one of");
  });

  it("includes the description so the message says what broke", () => {
    try {
      parseEnv(schema, { ...complete, PAGE_SIZE: "0" }, { production: true });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvSchemaError).problems[0]).toContain("Items per page");
    }
  });

  /** A production-only requirement may genuinely be absent while developing. */
  it("keeps missing development requirements optional in both value and type", () => {
    const development = parseEnv(schema, {}, { production: false });

    expect(development.GATEWAY_TOKEN).toBeUndefined();
    expectTypeOf(development.GATEWAY_TOKEN).toEqualTypeOf<string | undefined>();
    expect(() => parseEnv(schema, {}, { production: true })).toThrow(EnvSchemaError);
  });

  it("narrows required values when production validation is explicit", () => {
    const production = parseEnv(schema, complete, { production: true });

    expectTypeOf(production.GATEWAY_TOKEN).toEqualTypeOf<string>();
  });

  it("rejects a URL with an unexpected protocol", () => {
    expect(() =>
      parseEnv(schema, { ...complete, SITE_URL: "ftp://example.com" }, { production: true }),
    ).toThrow(/SITE_URL must use/);
  });

  it("treats an empty string as absent, not as a value", () => {
    const env = parseEnv(schema, { ...complete, PAGE_SIZE: "   " }, { production: true });
    expect(env.PAGE_SIZE).toBe(20);
  });
});

describe("the public/secret boundary", () => {
  it("splits the schema by declared access", () => {
    expect(publicEnvNames(schema)).toEqual(["FEATURE_X", "LOG_LEVEL", "PAGE_SIZE", "SITE_URL"]);
    expect(secretEnvNames(schema)).toEqual(["GATEWAY_TOKEN"]);
  });

  /**
   * The whole point: the browser-bound object is derived from the schema, so a
   * secret cannot be added to it by writing one more line somewhere else.
   */
  it("never carries a secret into the client-bound object", () => {
    const shipped = publicEnv(schema, parseEnv(schema, complete, { production: true }));

    expect(shipped).not.toHaveProperty("GATEWAY_TOKEN");
    expect(Object.values(shipped)).not.toContain("t0ken");
    expect(shipped.SITE_URL).toBe("https://example.com");
  });
});
