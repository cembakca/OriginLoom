// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createIslandMounter } from "../src/lib/client/island-mount";

afterEach(() => {
  document.body.replaceChildren();
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
});
