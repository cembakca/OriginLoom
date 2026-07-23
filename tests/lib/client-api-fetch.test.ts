import { afterEach, describe, expect, it, vi } from "vitest";

import { clientApiFetch } from "@originloom/react/lib/client/api-fetch";
import { getUserInfo, seedUserInfo } from "@originloom/react/lib/stores/user-info-store";

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
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/internal/refresh",
      expect.objectContaining({ method: "POST", credentials: "include" }),
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
