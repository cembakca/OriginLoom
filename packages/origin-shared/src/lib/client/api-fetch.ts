import { seedUserInfo } from "../stores/user-info-store.js";

const REFRESH_PATH = "/api/internal/refresh";

/**
 * `fetch` with the one recovery every BFF call needs: a 401 means the access
 * token expired, not that the visitor is signed out, so the refresh endpoint is
 * given one chance to mint a new one before the call is retried.
 *
 * Exposed as a plain `fetch` so it can back a typed RPC client as well as
 * `clientApiFetch` — the recovery is a transport concern, and duplicating it
 * per client is how one of them silently loses it.
 */
export async function sessionAwareFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const send = () => fetch(input, { ...init, credentials: "same-origin" });

  const response = await send();
  // The refresh call answering 401 is the terminal answer; retrying it would
  // loop.
  if (response.status !== 401 || isRefreshRequest(input)) return response;

  const refreshed = await fetch(REFRESH_PATH, { method: "POST", credentials: "same-origin" });
  if (!refreshed.ok) return response;

  return send();
}

/**
 * Client island'lardan BFF / public API çağrıları — cookie oturumu taşır.
 *
 * `credentials: "same-origin"`, not `"include"`: this is documented (docs/auth.md)
 * as a same-origin-only BFF client, and `"same-origin"` makes the browser itself
 * enforce that — the session cookie is never attached if `path` is ever a
 * cross-origin URL, instead of relying on every caller to only ever pass a
 * same-origin relative path.
 */
export async function clientApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await sessionAwareFetch(path, { ...init, headers });

  if (!res.ok) {
    if (res.status === 401) seedUserInfo({ isSignedIn: false });
    const message = await res.text().catch(() => res.statusText);
    throw new ClientApiError(res.status, message || `HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

function isRefreshRequest(input: RequestInfo | URL): boolean {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return url === REFRESH_PATH || url.startsWith(`${REFRESH_PATH}?`);
}

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}
