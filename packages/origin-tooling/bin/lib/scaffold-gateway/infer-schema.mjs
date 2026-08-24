/** @typedef {import('./generate.mjs').InferredSchema} InferredSchema */

const DEFAULT_STRING_MAX = 2_000;
const DEFAULT_ARRAY_MAX = 100;

/**
 * Build a JSON Schema 2020-12 fragment and parallel guard hints from a sample value.
 * @param {unknown} value
 * @param {{ maxDepth?: number }} [options]
 * @returns {InferredSchema}
 */
export function inferSchemaFromSample(value, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  return inferNode(value, maxDepth);
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {InferredSchema}
 */
function inferNode(value, depth) {
  if (value === null || value === undefined) {
    return { schema: { type: "null" }, tsType: "null", guard: "() => false" };
  }
  if (typeof value === "boolean") {
    return { schema: { type: "boolean" }, tsType: "boolean", guard: "isBoolean" };
  }
  if (typeof value === "number") {
    const integer = Number.isSafeInteger(value);
    const schema = integer
      ? { type: "integer", minimum: Math.min(value, 0), maximum: Math.max(value, 0) }
      : { type: "number", minimum: Math.min(value, 0), maximum: Math.max(value, 0) };
    return {
      schema,
      tsType: "number",
      guard: integer ? "isSafeInteger" : "isFiniteNumber",
      numberOptions: { integer, min: schema.minimum, max: schema.maximum },
    };
  }
  if (typeof value === "string") {
    const maxLength = Math.min(Math.max(value.length * 2, 32), DEFAULT_STRING_MAX);
    return {
      schema: { type: "string", maxLength },
      tsType: "string",
      guard: "isBoundedString",
      stringMaxLength: maxLength,
    };
  }
  if (Array.isArray(value)) {
    if (depth <= 0 || value.length === 0) {
      return {
        schema: { type: "array", maxItems: DEFAULT_ARRAY_MAX, items: {} },
        tsType: "unknown[]",
        guard: "isBoundedArrayUnknown",
        arrayMaxItems: DEFAULT_ARRAY_MAX,
      };
    }
    const item = inferNode(value[0], depth - 1);
    const maxItems = Math.min(Math.max(value.length * 2, 20), DEFAULT_ARRAY_MAX);
    return {
      schema: { type: "array", maxItems, items: item.schema },
      tsType: `${item.tsType}[]`,
      guard: "isBoundedArray",
      arrayMaxItems: maxItems,
      item,
    };
  }
  if (typeof value === "object") {
    if (depth <= 0) {
      return {
        schema: { type: "object", additionalProperties: true },
        tsType: "Record<string, unknown>",
        guard: "isRecord",
      };
    }
    const properties = {};
    const required = [];
    const fields = [];
    for (const [key, child] of Object.entries(value)) {
      const inferred = inferNode(child, depth - 1);
      properties[key] = inferred.schema;
      required.push(key);
      fields.push({ key, ...inferred });
    }
    return {
      schema: {
        type: "object",
        required,
        properties,
        additionalProperties: true,
      },
      tsType: null,
      guard: "isRecord",
      fields,
    };
  }
  return { schema: {}, tsType: "unknown", guard: "() => false" };
}

/** @param {string} id kebab-case contract id */
export function defaultSchemaName(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** @param {string} id kebab-case */
export function defaultContractKey(id) {
  return id.replace(/-/g, "_");
}

/** @param {string} id kebab-case contract id */
export function defaultGatewayPropertyKey(id) {
  return id.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}
