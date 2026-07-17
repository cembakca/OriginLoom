/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { installReloadButtons } from "~/lib/client/reload-button";

afterEach(() => document.body.replaceChildren());

describe("route error reload button", () => {
  it("reloads from a button without creating a crawlable self-link", () => {
    document.body.innerHTML = "<button data-reload-page><span>Tekrar dene</span></button>";
    const reload = vi.fn();
    const remove = installReloadButtons(document, reload);

    document.querySelector("span")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(reload).toHaveBeenCalledOnce();

    remove();
  });
});
