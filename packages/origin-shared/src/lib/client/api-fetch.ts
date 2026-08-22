import { seedUserInfo } from "../stores/user-info-store.js";

const REFRESH_PATH = "/api/internal/refresh";

/**
 * Client island'lardan BFF / public API çağrıları — cookie oturumu taşır.
 *
 * `credentials: "same-origin"`, not `"include"`: this is documented (docs/auth.md)
 * as a same-origin-only BFF client, and `"same-origin"` makes the browser itself
 * enforce that — the session cookie is never attached if `path` is ever a
 * cross-origin URL, instead of relying on every caller to only ever pass a
 * same-origin relative path.
 */
export async function clientApiFetch<T>(
  path: string,
  init: RequestInit = {},
  options?: { retried?: boolean },
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (
    res.status === 401 &&
    !options?.retried &&
    path !== REFRESH_PATH &&
    !path.startsWith(`${REFRESH_PATH}?`)
  ) {
    const refreshed = await fetch(REFRESH_PATH, {
      method: "POST",
      credentials: "same-origin",
    });
    if (refreshed.ok) {
      return clientApiFetch<T>(path, init, { retried: true });
    }
  }

  if (!res.ok) {
    if (res.status === 401) seedUserInfo({ isSignedIn: false });
    const message = await res.text().catch(() => res.statusText);
    throw new ClientApiError(res.status, message || `HTTP ${res.status}`);
  }

  return (await res.json()) as T;
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
