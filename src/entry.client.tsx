import "./styles/globals.css";

import { reportClientError } from "~/lib/client/error-telemetry";
import { bootstrapIslandElements } from "~/lib/client/island-runtime";
import { installReloadButtons } from "~/lib/client/reload-button";

installReloadButtons();

const mountIsland = (element: HTMLElement) => {
  import("./hydrate.client")
    .then(({ mount }) => void mount(element))
    .catch((error) => reportClientError("island-bootstrap", error));
};

const elements = document.querySelectorAll<HTMLElement>("[data-island]");

if (elements.length > 0) {
  bootstrapIslandElements(elements, mountIsland, {
    onObserverError: (error) => reportClientError("island-bootstrap", error),
  });
}

const observer = new MutationObserver((mutations) => {
  const newElements: HTMLElement[] = [];
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (element.hasAttribute("data-island")) {
          newElements.push(element);
        }
        const children = element.querySelectorAll<HTMLElement>("[data-island]");
        for (const child of children) {
          newElements.push(child);
        }
      }
    }
  }
  if (newElements.length > 0) {
    bootstrapIslandElements(newElements, mountIsland, {
      onObserverError: (error) => reportClientError("island-bootstrap", error),
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });

if (document.readyState === "complete" || document.readyState === "interactive") {
  observer.disconnect();
} else {
  window.addEventListener(
    "DOMContentLoaded",
    () => {
      observer.disconnect();
    },
    { once: true },
  );
}
