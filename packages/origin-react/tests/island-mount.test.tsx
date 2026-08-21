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

  it("shows a PII-free support reference beside the island without erasing SSR content", async () => {
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

    // The SSR fallback content inside the island root must survive.
    expect(element.textContent).toBe("SSR fallback");
    expect(element.getAttribute("role")).not.toBe("alert");
    expect(element.dataset.errorReference).toBe(payload.errorId);

    // A separate, accessible status element carries the visible reference.
    const status = element.nextElementSibling;
    expect(status).not.toBeNull();
    expect(status?.getAttribute("role")).toBe("alert");
    expect(status?.textContent).toContain(payload.errorId);
    expect(status?.textContent).not.toContain(payload.message);
  });

  it("uses an app-supplied formatter instead of a platform-hardcoded string", async () => {
    const element = document.createElement("div");
    element.dataset.island = "missing-island";
    element.dataset.mode = "defer";
    element.dataset.props = "{}";
    document.body.append(element);

    const mount = createIslandMounter({
      modules: {},
      formatIslandError: ({ errorId }) => `Özür dileriz — referans: ${errorId}`,
    });
    await mount(element);

    const status = element.nextElementSibling;
    expect(status?.textContent).toMatch(/^Özür dileriz — referans: /);
  });

  it("reuses the same status element instead of duplicating it on repeated failures", async () => {
    const element = document.createElement("div");
    element.dataset.island = "missing-island";
    element.dataset.mode = "defer";
    element.dataset.props = "{}";
    document.body.append(element);
    const parent = element.parentElement!;

    const mount = createIslandMounter({ modules: {} });
    await mount(element);
    await mount(element);

    const statusElements = parent.querySelectorAll('[data-island-error-for="missing-island"]');
    expect(statusElements.length).toBe(1);
  });

  it("clears the status element and error attributes on a successful retry", async () => {
    const element = document.createElement("div");
    element.dataset.island = "flaky";
    element.dataset.mode = "defer";
    element.dataset.props = "{}";
    document.body.append(element);
    const parent = element.parentElement!;

    const failingMount = createIslandMounter({ modules: {} });
    await failingMount(element);
    expect(element.dataset.errorReference).toBeDefined();
    expect(parent.querySelector('[data-island-error-for="flaky"]')).not.toBeNull();

    const workingMount = createIslandMounter({
      modules: {
        "./islands/flaky.tsx": async () => ({ default: () => <p>Recovered</p> }),
      },
    });
    await act(async () => {
      await workingMount(element);
    });

    expect(element.dataset.hydrated).toBe("");
    expect(element.dataset.errorReference).toBeUndefined();
    expect(parent.querySelector('[data-island-error-for="flaky"]')).toBeNull();
  });

  it("invokes the explicit component-failure hook only for genuine post-mount errors, not loader failures", async () => {
    const onComponentFailure = vi.fn();

    const loaderFailureElement = document.createElement("div");
    loaderFailureElement.dataset.island = "missing-island";
    loaderFailureElement.dataset.mode = "defer";
    loaderFailureElement.dataset.props = "{}";
    document.body.append(loaderFailureElement);

    const mount = createIslandMounter({ modules: {}, onComponentFailure });
    await mount(loaderFailureElement);

    expect(onComponentFailure).not.toHaveBeenCalled();
  });
});
