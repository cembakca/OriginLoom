import {
  getUserInfo,
  seedUserInfo,
  subscribeUserInfo,
} from "@originloom/react/lib/stores/user-info-store";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => seedUserInfo({ isSignedIn: false }));

describe("user info store", () => {
  it("notifies subscribed UI when authoritative session data changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUserInfo(listener);

    seedUserInfo({ isSignedIn: true, displayName: "Cem Bakca", initials: "CB" });

    expect(listener).toHaveBeenCalledOnce();
    expect(getUserInfo()).toEqual({
      isSignedIn: true,
      displayName: "Cem Bakca",
      initials: "CB",
    });
    unsubscribe();
  });

  it("removes stale profile fields when the session is rejected", () => {
    seedUserInfo({ isSignedIn: true, displayName: "Spoofed", initials: "SP" });

    seedUserInfo({ isSignedIn: false });

    expect(getUserInfo()).toEqual({ isSignedIn: false });
  });
});
