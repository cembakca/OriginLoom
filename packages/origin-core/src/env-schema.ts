/**
 * A typed, declared environment.
 *
 * Startup validation already refuses to boot on a missing `GATEWAY_URL`, and
 * that is the important half. What it does not give is a *type* — every read is
 * `process.env.SOMETHING`, a `string | undefined` that each call site parses
 * again — or a boundary: nothing distinguishes a value that may be rendered
 * into the page from one that must never leave the server.
 *
 * A schema fixes both. Declaring a variable once yields its parsed type, and
 * declaring its `access` makes the public/secret split something the compiler
 * and the build can check instead of something a reviewer has to notice.
 */
export type EnvAccess = "public" | "secret";

export type EnvVarBase = {
  /** What this configures, and what breaks without it. Shown when validation fails. */
  description: string;
  /**
   * `public` values may be rendered into the page or bundled into client code;
   * `secret` values must never leave the server. Nothing infers this — a URL is
   * not automatically public and a token is not automatically secret.
   */
  access: EnvAccess;
  /** Required in production. A development default keeps local runs working. */
  required?: boolean;
};

export type EnvVarSpec =
  | (EnvVarBase & { type: "string"; default?: string; pattern?: RegExp })
  | (EnvVarBase & { type: "number"; default?: number; min?: number; max?: number })
  | (EnvVarBase & { type: "boolean"; default?: boolean })
  | (EnvVarBase & { type: "url"; default?: string; protocols?: readonly string[] })
  | (EnvVarBase & { type: "enum"; values: readonly string[]; default?: string });

export type EnvSchema = Record<string, EnvVarSpec>;

/** The parsed value of one spec — this is what makes the schema worth having. */
export type EnvValue<S extends EnvVarSpec> = S extends { type: "number" }
  ? number
  : S extends { type: "boolean" }
    ? boolean
    : S extends { type: "enum"; values: readonly (infer V)[] }
      ? V
      : string;

/**
 * The sound result when the runtime mode is development or not known to the
 * compiler. A default is always present; a production-only requirement may be
 * absent while developing and therefore remains optional here.
 */
export type ParsedEnv<S extends EnvSchema> = {
  [K in keyof S]: S[K] extends { default: unknown } ? EnvValue<S[K]> : EnvValue<S[K]> | undefined;
};

/** The stronger result available when production validation was explicitly requested. */
export type ProductionParsedEnv<S extends EnvSchema> = {
  [K in keyof S]: S[K] extends { required: true }
    ? EnvValue<S[K]>
    : S[K] extends { default: unknown }
      ? EnvValue<S[K]>
      : EnvValue<S[K]> | undefined;
};

export class EnvSchemaError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Environment is not valid:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvSchemaError";
  }
}

/**
 * Parses and validates the whole environment at once.
 *
 * Every problem is collected before throwing. Failing on the first one turns a
 * misconfigured deploy into a sequence of restarts, each revealing one more
 * mistake; a single message listing all of them is one fix.
 */
export function parseEnv<S extends EnvSchema>(
  schema: S,
  env: NodeJS.ProcessEnv,
  options: { production: true },
): ProductionParsedEnv<S>;
export function parseEnv<S extends EnvSchema>(
  schema: S,
  env?: NodeJS.ProcessEnv,
  options?: { production?: boolean },
): ParsedEnv<S>;
export function parseEnv<S extends EnvSchema>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
  options: { production?: boolean } = {},
): ParsedEnv<S> | ProductionParsedEnv<S> {
  const production = options.production ?? env.NODE_ENV === "production";
  const problems: string[] = [];
  const parsed: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(schema)) {
    const raw = env[name]?.trim();

    if (raw === undefined || raw === "") {
      // A development default is a convenience, never a production stand-in:
      // shipping with someone's laptop value is the failure this prevents.
      if (spec.required && production) {
        problems.push(`${name} is required in production — ${spec.description}`);
      }
      parsed[name] =
        spec.type === "enum" ? spec.default : "default" in spec ? spec.default : undefined;
      continue;
    }

    const result = parseValue(name, spec, raw);
    if (result.ok) parsed[name] = result.value;
    else problems.push(`${result.problem} — ${spec.description}`);
  }

  if (problems.length > 0) throw new EnvSchemaError(problems);
  return parsed as ParsedEnv<S>;
}

/**
 * The variables that may cross to the browser.
 *
 * Used by the build to decide what a client bundle is allowed to see. The list
 * is derived from the schema, so marking something `secret` removes it here
 * too — there is no second place to remember.
 */
export function publicEnvNames(schema: EnvSchema): string[] {
  return Object.entries(schema)
    .filter(([, spec]) => spec.access === "public")
    .map(([name]) => name)
    .sort();
}

/** Names that must never be serialized anywhere a browser can read. */
export function secretEnvNames(schema: EnvSchema): string[] {
  return Object.entries(schema)
    .filter(([, spec]) => spec.access === "secret")
    .map(([name]) => name)
    .sort();
}

/**
 * The public subset, ready to hand to a client bundle.
 *
 * Deliberately the only supported way to move configuration browser-side: an
 * ad-hoc `{ apiUrl: process.env.API_URL }` object works right up until someone
 * adds a token to it.
 */
export function publicEnv<S extends EnvSchema>(
  schema: S,
  parsed: ParsedEnv<S>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of publicEnvNames(schema)) out[name] = parsed[name as keyof ParsedEnv<S>];
  return out;
}

type ParseResult = { ok: true; value: unknown } | { ok: false; problem: string };

function parseValue(name: string, spec: EnvVarSpec, raw: string): ParseResult {
  switch (spec.type) {
    case "string":
      return spec.pattern && !spec.pattern.test(raw)
        ? { ok: false, problem: `${name} does not match ${String(spec.pattern)}` }
        : { ok: true, value: raw };

    case "number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { ok: false, problem: `${name} is not a number: ${raw}` };
      if (spec.min !== undefined && value < spec.min) {
        return { ok: false, problem: `${name} must be at least ${spec.min}` };
      }
      if (spec.max !== undefined && value > spec.max) {
        return { ok: false, problem: `${name} must be at most ${spec.max}` };
      }
      return { ok: true, value };
    }

    case "boolean": {
      const normalized = raw.toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return { ok: true, value: true };
      if (["0", "false", "no", "off"].includes(normalized)) return { ok: true, value: false };
      return { ok: false, problem: `${name} is not a boolean: ${raw}` };
    }

    case "url": {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return { ok: false, problem: `${name} is not a URL: ${raw}` };
      }
      const allowed = spec.protocols ?? ["http:", "https:"];
      return allowed.includes(url.protocol)
        ? { ok: true, value: raw.replace(/\/$/, "") }
        : { ok: false, problem: `${name} must use ${allowed.join(" or ")}` };
    }

    case "enum":
      return spec.values.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, problem: `${name} must be one of ${spec.values.join(", ")}` };
  }
}
