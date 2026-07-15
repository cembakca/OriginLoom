import type { ReactNode } from "react";

/**
 * `hydrate` — server renders it, client wakes it up.
 *   Interactive, but identical for every visitor. Safe inside cached HTML.
 *
 * `defer` — server renders only the fallback; the client mounts it and
 *   fetches its own data.
 *   This is where anything per-user goes. It never touches the cached HTML,
 *   so the cache key never has to grow a session dimension.
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
      data-props={JSON.stringify(props ?? {})}
    >
      {mode === "hydrate" ? children : <div data-fallback="">{children}</div>}
    </div>
  );
}
