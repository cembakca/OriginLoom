import { isExternalUrl } from "./pattern.js";
import type { RedirectRule, RewriteRule } from "./types.js";

type Rule = RedirectRule | RewriteRule;
type RuleKind = "redirect" | "rewrite";

type SourceSegment =
  { kind: "static"; value: string } | { kind: "param"; name: string; modifier: "" | "?" | "*" };

/**
 * Fail fast on routing rules whose behavior would otherwise depend on ordering mistakes.
 *
 * Routing is intentionally single-pass: a rewrite destination is handed directly to the
 * application router and is never run through this rule set a second time.
 */
export function validateRoutingRules(opts: {
  redirects: RedirectRule[];
  rewrites: RewriteRule[];
}): void {
  const errors: string[] = [];

  validateRuleList("redirect", opts.redirects, errors);
  validateRuleList("rewrite", opts.rewrites, errors);

  for (let ri = 0; ri < opts.redirects.length; ri++) {
    const redirect = opts.redirects[ri];
    if (!redirect) continue;
    for (let wi = 0; wi < opts.rewrites.length; wi++) {
      const rewrite = opts.rewrites[wi];
      if (!rewrite) continue;
      if (patternCovers(redirect.source, rewrite.source)) {
        errors.push(
          `rewrite[${wi}] ${rewrite.source} is unreachable because redirect[${ri}] ${redirect.source} runs first`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid routing rules:\n- ${errors.join("\n- ")}`);
  }
}

function validateRuleList(kind: RuleKind, rules: Rule[], errors: string[]): void {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (!rule) continue;
    const label = `${kind}[${index}]`;

    const source = parseSource(rule.source, label, errors);
    validateDestination(rule, source, label, errors);

    if (
      kind === "rewrite" &&
      !isExternalUrl(rule.destination) &&
      rule.destination === rule.source
    ) {
      errors.push(`${label} maps ${rule.source} to itself`);
    }

    for (let previousIndex = 0; previousIndex < index; previousIndex++) {
      const previous = rules[previousIndex];
      if (previous && patternCovers(previous.source, rule.source)) {
        errors.push(
          `${label} ${rule.source} is unreachable because ${kind}[${previousIndex}] ${previous.source} matches first`,
        );
        break;
      }
    }
  }
}

function parseSource(source: string, label: string, errors: string[]): SourceSegment[] {
  if (!source.startsWith("/")) {
    errors.push(`${label} source must start with "/": ${source}`);
    return [];
  }
  if (source.includes("#")) errors.push(`${label} source cannot contain a fragment: ${source}`);

  const parts = source.split("/").filter(Boolean);
  const segments: SourceSegment[] = [];
  const params = new Set<string>();

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part) continue;
    if (!part.startsWith(":")) {
      if (part.includes("?"))
        errors.push(`${label} source cannot contain a query string: ${source}`);
      try {
        decodeURIComponent(part);
      } catch {
        errors.push(`${label} contains malformed percent-encoding: ${source}`);
      }
      segments.push({ kind: "static", value: part });
      continue;
    }

    const match = /^:([A-Za-z_][A-Za-z0-9_]*)([?*]?)$/.exec(part);
    if (!match?.[1]) {
      errors.push(`${label} has an invalid parameter segment: ${part}`);
      continue;
    }
    const name = match[1];
    const modifier = (match[2] ?? "") as "" | "?" | "*";
    if (params.has(name)) errors.push(`${label} declares parameter :${name} more than once`);
    if (modifier === "*" && index !== parts.length - 1) {
      errors.push(`${label} splat parameter must be the final segment: ${part}`);
    }
    if (modifier === "?" && index !== parts.length - 1) {
      errors.push(`${label} optional parameter must be the final segment: ${part}`);
    }
    params.add(name);
    segments.push({ kind: "param", name, modifier });
  }

  return segments;
}

function validateDestination(
  rule: Rule,
  source: SourceSegment[],
  label: string,
  errors: string[],
): void {
  if (!rule.destination.startsWith("/") && !isExternalUrl(rule.destination)) {
    errors.push(
      `${label} destination must be an absolute path or http(s) URL: ${rule.destination}`,
    );
    return;
  }

  let destination: URL;
  try {
    destination = new URL(rule.destination, "http://rewrite.local");
  } catch {
    errors.push(`${label} has an invalid destination: ${rule.destination}`);
    return;
  }
  if (isExternalUrl(rule.destination) && !["http:", "https:"].includes(destination.protocol)) {
    errors.push(`${label} external destination must use http or https: ${rule.destination}`);
  }

  const sourceParams = new Set(
    source.filter((segment) => segment.kind === "param").map((segment) => segment.name),
  );
  const destinationParams = rule.destination.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)(?:\*)?/g);
  for (const match of destinationParams) {
    const name = match[1];
    if (name && !sourceParams.has(name)) {
      errors.push(`${label} destination references unknown parameter :${name}`);
    }
  }
}

/** True only when the first pattern certainly makes the second one unreachable. */
function patternCovers(first: string, second: string): boolean {
  const a = parseForComparison(first);
  const b = parseForComparison(second);
  if (!a || !b) return false;

  const last = a.at(-1);
  const catchAll = last?.kind === "param" && last.modifier === "*";
  const optionalTail = last?.kind === "param" && last.modifier === "?";
  const prefixLength = catchAll || optionalTail ? a.length - 1 : a.length;
  if (catchAll && b.length < prefixLength) return false;
  if (optionalTail && b.length !== prefixLength && b.length !== a.length) return false;
  if (optionalTail) {
    const secondLast = b.at(-1);
    if (secondLast?.kind === "param" && secondLast.modifier === "*") return false;
  }
  if (!catchAll && !optionalTail && b.length !== a.length) return false;

  for (let index = 0; index < prefixLength; index++) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return false;
    if (left.kind === "static" && (right.kind !== "static" || left.value !== right.value)) {
      return false;
    }
    if (left.kind === "param" && left.modifier === "?" && right.kind === "param") {
      if (right.modifier === "*") return false;
    }
    if (
      left.kind === "param" &&
      left.modifier === "" &&
      right.kind === "param" &&
      right.modifier !== ""
    ) {
      return false;
    }
  }

  return true;
}

function parseForComparison(source: string): SourceSegment[] | null {
  if (!source.startsWith("/") || source.includes("#")) return null;
  const segments: SourceSegment[] = [];
  for (const part of source.split("/").filter(Boolean)) {
    const match = /^:([A-Za-z_][A-Za-z0-9_]*)([?*]?)$/.exec(part);
    if (part.startsWith(":")) {
      if (!match?.[1]) return null;
      segments.push({
        kind: "param",
        name: match[1],
        modifier: (match[2] ?? "") as "" | "?" | "*",
      });
    } else {
      segments.push({ kind: "static", value: part });
    }
  }
  return segments;
}
