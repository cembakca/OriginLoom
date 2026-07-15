const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:8080";

/** Loader-side gateway fetch — forwards Authorization injected by auth middleware. */
export function gatewayFetch(request: Request, path: string, init: RequestInit = {}): Promise<Response> {
  const base = GATEWAY_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(init.headers);

  const auth = request.headers.get("Authorization");
  if (auth) headers.set("Authorization", auth);

  return fetch(`${base}${p}`, { ...init, headers });
}

export function gatewayUrl(): string {
  return GATEWAY_URL.replace(/\/$/, "");
}
