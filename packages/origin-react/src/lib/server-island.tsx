/** @jsxRuntime automatic */ /** @jsxImportSource react */
import type { ReactNode } from "react";

/**
 * A hole in cached HTML that the server fills for this visitor.
 *
 * Use it where a `defer` island would otherwise go; the difference is where the
 * personal markup is produced. A `defer` island ships its component to the
 * browser, mounts it and lets it fetch. This renders the same markup on the
 * server and swaps the result in, so the component's JavaScript never reaches
 * the client at all.
 *
 * `payload` comes from `signServerIslandPayload` in `@originloom/core` — the
 * renderer package cannot reach the server core, and that is the right shape
 * anyway: signing is a server concern, and passing the signed value in keeps it
 * visible at the call site rather than hidden inside a component.
 *
 * Whatever the signed props describe is written into HTML every visitor
 * receives, so they describe the *hole*, never the person. Identity is read
 * from the request when the island renders.
 *
 * `children` are the fallback: what a visitor sees before the fill lands, and
 * what they keep seeing if it fails or if scripts are off.
 */
export function ServerIsland({
  name,
  payload,
  path,
  children,
}: {
  name: string;
  payload: string;
  /** The page the placeholder sits on; passed to the island for links and logs. */
  path?: string;
  children?: ReactNode;
}) {
  return (
    <div data-server-island={name} data-payload={payload} data-path={path}>
      {children}
    </div>
  );
}
