const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8080";

export function gatewayUrl(path: string): string {
  const base = GATEWAY_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export async function gatewayFetch(
  path: string,
  init: RequestInit & { authorization?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.authorization) headers.set("Authorization", init.authorization);

  return fetch(gatewayUrl(path), { ...init, headers });
}
