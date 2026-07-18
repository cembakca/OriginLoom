import "./styles/globals.css";

import { reportClientError } from "~/lib/client/error-telemetry";
import { bootstrapIslandElements } from "~/lib/client/island-runtime";
import { installReloadButtons } from "~/lib/client/reload-button";

installReloadButtons();

const elements = document.querySelectorAll<HTMLElement>("[data-island]");

if (elements.length > 0) {
  // Dynamically load the heavy React/React-DOM/Hydration bundle only when islands are present.
  // This reduces bundle overhead to 0 kB React on purely static pages!
  import("./hydrate.client")
    .then(({ mount }) => {
      bootstrapIslandElements(
        elements,
        (element) => void mount(element),
        {
          onObserverError: (error) => reportClientError("island-bootstrap", error),
        },
      );
    })
    .catch((error) => {
      reportClientError("island-bootstrap", error);
    });
}
