import {
  configureGatewayIdentityHeaders,
  readGatewayIdentity,
} from "@originloom/core/adapters/gateway-identity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("@originloom/core/gateway-transport", () => ({ gatewayTransportFetch: mocks.transport }));

const { gatewayFetchForRequest, gatewayFetchWithIdentity } =
  await import("@originloom/core/adapters/gateway");

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/** What the pipeline hands a loader: the tracking cookie and the resolved client IP. */
function pipelineRequest(overrides: Record<string, string> = {}, userAgent = DESKTOP_UA) {
  return new Request("http://app.local/urunler", {
    headers: {
      cookie: "user_tracking_id=9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b",
      "x-client-ip": "203.0.113.9",
      "user-agent": userAgent,
      ...overrides,
    },
  });
}

function sentHeaders(): Headers {
  const init = mocks.transport.mock.calls.at(-1)?.[1] as RequestInit;
  return new Headers(init.headers);
}

describe("gateway identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transport.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    configureGatewayIdentityHeaders({});
  });

  it("reads the identity from the request rather than taking it on trust", () => {
    const identity = readGatewayIdentity(pipelineRequest());

    expect(identity).toEqual({
      userTrackingId: "9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b",
      clientIp: "203.0.113.9",
      deviceType: "Desktop",
    });
  });

  it("sends tracking id, client IP and device on every authenticated call", async () => {
    const request = pipelineRequest({ authorization: "Bearer token" });

    await gatewayFetchForRequest(request, "/account/summary");

    const headers = sentHeaders();
    expect(headers.get("x-user-tracking-id")).toBe("9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b");
    expect(headers.get("x-client-ip")).toBe("203.0.113.9");
    expect(headers.get("x-device-type")).toBe("Desktop");
    expect(headers.get("authorization")).toBe("Bearer token");
  });

  it("sends the same identity without credentials when the result is shared", async () => {
    await gatewayFetchWithIdentity(pipelineRequest({ authorization: "Bearer token" }), "/menu");

    const headers = sentHeaders();
    expect(headers.get("x-user-tracking-id")).toBe("9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b");
    expect(headers.get("x-device-type")).toBe("Desktop");
    // A shared read must not carry credentials: whatever comes back may be
    // rendered into HTML every other visitor sees.
    expect(headers.get("authorization")).toBeNull();
  });

  it("reports the device the visitor actually used", async () => {
    await gatewayFetchWithIdentity(pipelineRequest({}, MOBILE_UA), "/menu");

    expect(sentHeaders().get("x-device-type")).toBe("Mobile");
  });

  it("ignores an identity header the caller tried to supply", async () => {
    // The tracking id comes from the cookie the session step minted. A client
    // that sets the header itself must not be able to speak as someone else.
    const forged = pipelineRequest({ "x-user-tracking-id": "attacker-supplied" });

    await gatewayFetchWithIdentity(forged, "/menu");

    expect(sentHeaders().get("x-user-tracking-id")).toBe("9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b");
  });

  it("reports no IP rather than a wrong one outside the request pipeline", async () => {
    const worker = new Request("http://app.local/job", {
      headers: { "user-agent": DESKTOP_UA },
    });

    await gatewayFetchWithIdentity(worker, "/menu");

    const headers = sentHeaders();
    expect(headers.get("x-client-ip")).toBeNull();
    expect(headers.get("x-user-tracking-id")).toBeNull();
    expect(headers.get("x-device-type")).toBe("Desktop");
  });

  it("reports the id the session step minted, on the visit that mints it", async () => {
    // A visitor's first request has no cookie yet — it is created in the
    // response. Without the header the session step publishes, the very requests
    // that create a visitor would reach the gateway anonymous.
    const firstVisit = new Request("http://app.local/urunler", {
      headers: { "x-originloom-tracking-id": "5c0ffee0-1111-4222-8333-444455556666" },
    });

    await gatewayFetchWithIdentity(firstVisit, "/menu");

    expect(sentHeaders().get("x-user-tracking-id")).toBe("5c0ffee0-1111-4222-8333-444455556666");
  });

  it("uses the header names the gateway expects", async () => {
    configureGatewayIdentityHeaders({ userTrackingId: "X-Visitor-Id", deviceType: "X-Channel" });

    await gatewayFetchWithIdentity(pipelineRequest(), "/menu");

    const headers = sentHeaders();
    expect(headers.get("x-visitor-id")).toBe("9f1f2f7e-0f0e-4d3c-8b6a-2c1d0e5f4a3b");
    expect(headers.get("x-channel")).toBe("Desktop");
  });
});
