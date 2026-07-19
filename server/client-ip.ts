import { BlockList, isIP } from "node:net";

export type TrustedProxyOptions = {
  enabled: boolean;
  hops: number;
  cidrs: readonly string[];
};

const blockLists = new Map<string, BlockList>();

export function resolveTrustedClientIp(
  remoteAddress: string,
  headers: Headers,
  options: TrustedProxyOptions,
): string {
  const remote = normalizeIp(remoteAddress);
  if (!options.enabled || !remote || !isTrustedProxy(remote, options.cidrs)) return remoteAddress;

  const rawForwarded = headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "";
  const forwarded = rawForwarded
    .split(",")
    .map((value) => normalizeIp(value.trim()))
    .filter((value): value is string => Boolean(value));
  if (forwarded.some((value) => isIP(value) === 0)) return remoteAddress;

  const chain = [...forwarded, remote];
  if (chain.length <= options.hops) return remoteAddress;
  return chain[chain.length - 1 - options.hops] ?? remoteAddress;
}

function isTrustedProxy(address: string, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) return false;
  const key = cidrs.join(",");
  let blockList = blockLists.get(key);
  if (!blockList) {
    blockList = new BlockList();
    for (const cidr of cidrs) {
      const [rawAddress, rawPrefix] = cidr.split("/");
      const normalized = rawAddress ? normalizeIp(rawAddress) : null;
      const family = normalized ? isIP(normalized) : 0;
      const prefix = rawPrefix === undefined ? (family === 4 ? 32 : 128) : Number(rawPrefix);
      if (!normalized || !family || !Number.isInteger(prefix)) continue;
      blockList.addSubnet(normalized, prefix, family === 4 ? "ipv4" : "ipv6");
    }
    blockLists.set(key, blockList);
  }
  return blockList.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
}

function normalizeIp(address: string): string | null {
  const value = address.trim().replace(/^\[|\]$/g, "");
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4) return value.slice(7);
  return isIP(value) ? value : null;
}
