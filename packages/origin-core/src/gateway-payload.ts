import {
  observeInvalidGatewayPayload,
  observePayloadSize,
  observeSerialization,
} from "./metrics.js";

/**
 * What an app expects back from one gateway endpoint: a label for logs and
 * metrics, and the largest response it is willing to read.
 *
 * The budget is a safety limit, not a guess — an upstream that suddenly returns
 * ten times the usual payload is a defect, and reading it would be the failure.
 * Apps declare their own contracts; the platform has no idea what domains exist.
 */
export type GatewayContract = {
  readonly name: string;
  readonly maxBytes: number;
};

export function defineGatewayContract(name: string, maxBytes: number): GatewayContract {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Gateway contract name must be snake_case: ${name}`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`Gateway contract ${name} needs a positive byte budget`);
  }
  return { name, maxBytes };
}

type InvalidPayloadReason = "json" | "schema" | "size";

export class GatewayPayloadError extends Error {
  constructor(
    readonly contract: string,
    readonly reason: InvalidPayloadReason,
    message: string,
  ) {
    super(message);
    this.name = "GatewayPayloadError";
  }
}

export async function readGatewayJson(
  response: Response,
  contract: GatewayContract,
  message: string,
): Promise<unknown> {
  const maxBytes = contract.maxBytes;
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      throw invalidPayload(contract, "size", message);
    }
  }

  const text = await readBoundedText(response, maxBytes, () =>
    invalidPayload(contract, "size", message),
  );
  observePayloadSize("gateway_json", contract.name, Buffer.byteLength(text));

  try {
    const started = performance.now();
    try {
      return JSON.parse(text) as unknown;
    } finally {
      observeSerialization("gateway_json_parse", contract.name, performance.now() - started);
    }
  } catch {
    throw invalidPayload(contract, "json", message);
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  sizeError: () => GatewayPayloadError,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw sizeError();
    }
    chunks.push(value);
  }
  if (chunks.length === 0) return "";
  if (chunks.length === 1) {
    const only = chunks[0]!;
    return Buffer.from(only.buffer, only.byteOffset, only.byteLength).toString("utf8");
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function requireGatewayPayload<T>(
  contract: GatewayContract,
  value: unknown,
  guard: (value: unknown) => value is T,
  message: string,
): T {
  if (!guard(value)) throw invalidPayload(contract, "schema", message);
  return value;
}

export function parseGatewayPayload<T>(
  contract: GatewayContract,
  value: unknown,
  parser: (value: unknown) => T | null,
  message: string,
): T {
  const parsed = parser(value);
  if (parsed === null) throw invalidPayload(contract, "schema", message);
  return parsed;
}

export function invalidPayload(
  contract: GatewayContract,
  reason: InvalidPayloadReason,
  message: string,
): GatewayPayloadError {
  observeInvalidGatewayPayload(contract.name, reason);
  return new GatewayPayloadError(contract.name, reason, message);
}
