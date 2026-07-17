import { isIP } from "node:net";

export function resolveTrustedClientIp(
  remoteAddress: string,
  headers: Headers,
  trustProxy: boolean,
): string {
  if (!trustProxy) return remoteAddress;
  const forwarded =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "";
  return isIP(forwarded) ? forwarded : remoteAddress;
}
