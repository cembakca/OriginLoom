const EMBEDDED_JSON_ESCAPE_PATTERN = /[<>&/\u2028\u2029]/g;

/**
 * Serializes JSON that will be embedded in crawler-visible HTML.
 *
 * Solidus is escaped as `\/` so route-like values are not exposed as raw
 * slash-prefixed URL candidates. The remaining escapes keep the same output
 * safe if it is later moved from a data attribute into an inline JSON/script
 * container. All escapes are standard JSON and are restored by JSON.parse.
 */
export function serializeEmbeddedJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new TypeError("Embedded JSON value must be JSON-serializable");
  }

  return json.replace(EMBEDDED_JSON_ESCAPE_PATTERN, embeddedJsonEscape);
}

export function parseEmbeddedJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function embeddedJsonEscape(character: string): string {
  switch (character) {
    case "/":
      return "\\/";
    case "<":
      return "\\u003c";
    case ">":
      return "\\u003e";
    case "&":
      return "\\u0026";
    case "\u2028":
      return "\\u2028";
    case "\u2029":
      return "\\u2029";
    default:
      return character;
  }
}
