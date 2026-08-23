import "./styles/globals.css";

import {
  logPageRequestIdInDev,
  reportClientError,
} from "@originloom/shared/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/shared/lib/client/island-runtime";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";
import { fillServerIslands } from "@originloom/shared/lib/client/server-island-fill";

installReloadButtons();
logPageRequestIdInDev();

// Server-rendered holes, filled before any island work: this is markup the
// server already produced, so it costs one request and no component code.
void fillServerIslands(document, {
  onError: (island, error) => reportClientError("server-island", error, { island }),
});

runIslandBootstrap(
  (element) => {
    import("./hydrate.client")
      .then(({ mount }) => void mount(element))
      .catch((error) => reportClientError("island-bootstrap", error));
  },
  { onObserverError: (error) => reportClientError("island-bootstrap", error) },
);
