/** @jsxRuntime automatic */ /** @jsxImportSource react */
import { serializeEmbeddedJson } from "@originloom/shared/lib/embedded-json";
import type { ReactNode } from "react";

/**
 * `hydrate` — server renders it, client wakes it up.
 *   Interactive, but identical for every visitor. Safe inside cached HTML.
 *
 * `defer` — server renders only the fallback; the client mounts it and
 *   fetches its own data.
 *   This is where anything per-user goes. It never touches the cached HTML,
 *   so the cache key never has to grow a session dimension.
 *
 * `eager` — sayfa yüklenir yüklenmez JS chunk indirilir (layout-client, analytics).
 *   Yoksa IntersectionObserver viewport'a yaklaşınca yükler (footer, menü…).
 */
export function Island({
  name,
  mode = "hydrate",
  props,
  eager,
  children,
}: {
  name: string;
  mode?: "hydrate" | "defer";
  props?: unknown;
  eager?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-island={name}
      data-mode={mode}
      data-eager={eager ? "" : undefined}
      data-props={
        props === undefined ? undefined : serializeEmbeddedJson(props, `island "${name}" props`)
      }
    >
      {mode === "hydrate" ? children : <div data-fallback="">{children}</div>}
    </div>
  );
}
