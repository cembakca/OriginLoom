import "./styles/globals.css";

import { reportClientError } from "@originloom/react/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/react/lib/client/island-runtime";
import { installReloadButtons } from "@originloom/react/lib/client/reload-button";

installReloadButtons();

runIslandBootstrap(
  (element) => {
    import("./hydrate.client")
      .then(({ mount }) => void mount(element))
      .catch((error) => reportClientError("island-bootstrap", error));
  },
  { onObserverError: (error) => reportClientError("island-bootstrap", error) },
);
