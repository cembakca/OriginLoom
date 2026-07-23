import {
  GatewayPayloadError,
  readGatewayJson,
  requireGatewayPayload,
} from "@originloom/core/gateway-payload";
import { renderMetrics } from "@originloom/core/metrics";
import { describe, expect, it } from "vitest";

describe("gateway payload boundary", () => {
  it("rejects declared and actual bodies above the endpoint limit", async () => {
    await expect(
      readGatewayJson(
        new Response("{}", { headers: { "content-length": "20000" } }),
        "profile",
        "invalid profile",
      ),
    ).rejects.toMatchObject({ reason: "size" } satisfies Partial<GatewayPayloadError>);

    await expect(
      readGatewayJson(
        new Response(JSON.stringify({ displayName: "x".repeat(20_000) })),
        "profile",
        "invalid profile",
      ),
    ).rejects.toMatchObject({ reason: "size" } satisfies Partial<GatewayPayloadError>);
  });

  it("distinguishes malformed JSON from a schema mismatch", async () => {
    await expect(
      readGatewayJson(new Response("{broken"), "redirect", "invalid redirect"),
    ).rejects.toMatchObject({ reason: "json" } satisfies Partial<GatewayPayloadError>);

    expect(() =>
      requireGatewayPayload(
        "offers",
        { offers: [] },
        (value): value is unknown[] => Array.isArray(value),
        "invalid offers",
      ),
    ).toThrowError(GatewayPayloadError);

    const metrics = renderMetrics();
    expect(metrics).toContain(
      'ssr_gateway_invalid_payload_total{contract="profile",reason="size"}',
    );
    expect(metrics).toContain(
      'ssr_gateway_invalid_payload_total{contract="redirect",reason="json"}',
    );
    expect(metrics).toContain(
      'ssr_gateway_invalid_payload_total{contract="offers",reason="schema"}',
    );
  });
});
