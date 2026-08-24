import "./styles/globals.css";

import {
  logPageRequestIdInDev,
  reportClientError,
} from "@originloom/shared/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/shared/lib/client/island-runtime";
import type { OriginLoomClientOptions } from "@originloom/shared/lib/client/options";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";
import { fillServerIslands } from "@originloom/shared/lib/client/server-island-fill";

const originLoomOptions: OriginLoomClientOptions = {
  devtools: true,
};
const devtoolsEnabled = originLoomOptions.devtools ?? true;

installReloadButtons();
logPageRequestIdInDev();

// Dev only, and loaded lazily so the module never enters a production bundle:
// `import.meta.env.DEV` is statically false there, and the dynamic import is
// dropped with the branch.
if (import.meta.env.DEV && devtoolsEnabled) {
  void import("@originloom/shared/lib/client/devtools").then(({ mountDevtoolsPanel }) =>
    mountDevtoolsPanel({ enabled: devtoolsEnabled }),
  );
}

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
