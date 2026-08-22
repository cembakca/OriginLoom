import { clientApiFetch } from "@originloom/shared/lib/client/api-fetch";
import { getUserInfo, seedUserInfo } from "@originloom/shared/lib/stores/user-info-store";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  seedUserInfo({ isSignedIn: false });
  vi.unstubAllGlobals();
});

describe("client API fetch", () => {
  it("refreshes once and retries the protected request after a 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ value: "verified" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(clientApiFetch<{ value: string }>("/api/internal/example")).resolves.toEqual({
      value: "verified",
    });
    // "same-origin", not "include": the browser itself must refuse to attach
    // the session cookie if `path` were ever a cross-origin URL, rather than
    // relying on every caller to only ever pass a same-origin relative path.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/internal/example",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/internal/refresh",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears reactive UI state after the final 401", async () => {
    seedUserInfo({ isSignedIn: true, displayName: "Spoofed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(clientApiFetch("/api/internal/example")).rejects.toMatchObject({ status: 401 });
    expect(getUserInfo()).toEqual({ isSignedIn: false });
  });
});
