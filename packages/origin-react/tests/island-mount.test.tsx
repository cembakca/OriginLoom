// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIslandMounter } from "../src/lib/client/island-mount";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("createIslandMounter", () => {
  it("marks an island ready only after React commits", async () => {
    const element = document.createElement("div");
    element.dataset.island = "status";
    element.dataset.mode = "defer";
    element.dataset.props = "{}";
    document.body.append(element);

    const mount = createIslandMounter({
      modules: {
        "./islands/status.tsx": async () => ({ default: () => <p>Hazır</p> }),
      },
    });

    expect(element.dataset.hydrated).toBeUndefined();
    await act(async () => {
      await mount(element);
    });

    expect(element.dataset.hydrated).toBe("");
    expect(element.textContent).toBe("Hazır");
  });

  it("shows a PII-free support reference when an island cannot load", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElement("div");
    element.dataset.island = "missing-island";
    element.dataset.mode = "defer";
    element.dataset.props = "{}";
    element.textContent = "SSR fallback";
    document.body.append(element);

    const mount = createIslandMounter({ modules: {} });
    await mount(element);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    if (typeof request.body !== "string") throw new Error("Expected string telemetry body");
    const payload = JSON.parse(request.body) as { errorId: string; message: string };
    expect(element.getAttribute("role")).toBe("alert");
    expect(element.dataset.errorReference).toBe(payload.errorId);
    expect(element.textContent).toBe(`Bir sorun oluştu. Referans: ${payload.errorId}`);
    expect(element.textContent).not.toContain(payload.message);
  });
});
