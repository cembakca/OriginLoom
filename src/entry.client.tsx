import "./styles/globals.css";

import { reportClientError } from "~/lib/client/error-telemetry";
import { runIslandBootstrap } from "~/lib/client/island-runtime";
import { installReloadButtons } from "~/lib/client/reload-button";

installReloadButtons();

runIslandBootstrap(
  (element) => {
    import("./hydrate.client")
      .then(({ mount }) => void mount(element))
      .catch((error) => reportClientError("island-bootstrap", error));
  },
  { onObserverError: (error) => reportClientError("island-bootstrap", error) },
);
