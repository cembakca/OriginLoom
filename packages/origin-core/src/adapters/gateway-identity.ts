import { Cookie } from "@originloom/shared/lib/cookies";
import { getDeviceType } from "@originloom/shared/lib/device";
import { cookie } from "@originloom/shared/lib/request";

/**
 * The request-scoped identity every upstream call carries.
 *
 * Not one of these is derived from anything the caller sent as a header: the
 * tracking id is the cookie the session step minted, the client IP is what the
 * platform resolved through the trusted-proxy chain, and the device comes from
 * the User-Agent. A service therefore cannot forget to pass them and a caller
 * cannot spoof them by setting a header.
 */
export type GatewayIdentity = {
  userTrackingId?: string;
  clientIp?: string;
  deviceType: string;
};

/**
 * Header names this app sends them under. They are a contract with the gateway,
 * so they are configured once at startup rather than repeated at call sites.
 */
export type GatewayIdentityHeaderNames = {
  userTrackingId: string;
  clientIp: string;
  deviceType: string;
};

const DEFAULT_HEADER_NAMES: GatewayIdentityHeaderNames = {
  userTrackingId: "x-user-tracking-id",
  clientIp: "x-client-ip",
  deviceType: "x-device-type",
};

/**
 * Where the session step publishes the tracking id it resolved for this request.
 *
 * Internal to the pipeline and never sent upstream: the outgoing name is
 * whatever `configureGatewayIdentityHeaders` says.
 */
export const RESOLVED_TRACKING_ID_HEADER = "x-originloom-tracking-id";

let headerNames: GatewayIdentityHeaderNames = DEFAULT_HEADER_NAMES;

/** Override the header names when the gateway expects its own. */
export function configureGatewayIdentityHeaders(names: Partial<GatewayIdentityHeaderNames>): void {
  headerNames = { ...DEFAULT_HEADER_NAMES, ...names };
}

export function gatewayIdentityHeaderNames(): GatewayIdentityHeaderNames {
  return headerNames;
}

/**
 * Reads the identity out of the incoming request.
 *
 * `x-client-ip` is set by the session step from the resolved client address, so
 * it is present for document requests. A call made outside that pipeline — a
 * background worker, a cron — simply has no IP to report, and reports none
 * rather than inventing one.
 */
export function readGatewayIdentity(request: Request): GatewayIdentity {
  // The session step overwrites this header on the request it hands downstream,
  // so a client cannot forge it — and it is the only place the id exists on a
  // visitor's first request, where the cookie is still only in the response.
  const trackingId =
    request.headers.get(RESOLVED_TRACKING_ID_HEADER) ?? cookie(request, Cookie.userTrackingId);
  const clientIp = request.headers.get("x-client-ip") ?? undefined;
  return {
    ...(trackingId ? { userTrackingId: trackingId } : {}),
    ...(clientIp ? { clientIp } : {}),
    deviceType: getDeviceType(request),
  };
}

/** Applies the identity to an outgoing header set, without overwriting explicit values. */
export function applyGatewayIdentity(headers: Headers, identity: GatewayIdentity): Headers {
  const names = headerNames;
  if (identity.userTrackingId && !headers.has(names.userTrackingId)) {
    headers.set(names.userTrackingId, identity.userTrackingId);
  }
  if (identity.clientIp && !headers.has(names.clientIp)) {
    headers.set(names.clientIp, identity.clientIp);
  }
  if (!headers.has(names.deviceType)) headers.set(names.deviceType, identity.deviceType);
  return headers;
}
