import { config } from "./config.js";
import { type KeyRing, keyRing, signWithRing, verifyWithRing } from "./key-ring.js";

/**
 * A hole in cached HTML that the server fills per request.
 *
 * The shell goes out of the shared cache exactly as it is; where the personal
 * part belongs there is a placeholder, and a second request renders that part
 * on the server and swaps it in. Compared with a `defer` island — which ships
 * the component to the browser and lets it fetch its own data — the personal
 * markup here is produced on the server, so the component's JavaScript never
 * reaches the client at all.
 *
 * Two rules make it safe:
 *
 * 1. **Props are public.** They are baked into HTML every visitor receives, so
 *    they must describe the *hole*, never the person. Identity is read from the
 *    request when the island renders, not carried in the placeholder.
 * 2. **Props are signed.** The render endpoint would otherwise be an open
 *    invitation to render any registered island with any input the caller
 *    invented. The signature says these props came from this server.
 */
export type ServerIslandPayload = { name: string; props: unknown };

export type ServerIslandContext = {
  request: Request;
  /** Where the placeholder was rendered — for logging and for the island's own links. */
  pagePath: string;
};

/** Renders one island to HTML. Anything per-visitor comes from `context.request`. */
export type ServerIslandRenderer = (
  props: unknown,
  context: ServerIslandContext,
) => string | Promise<string>;

export type ServerIslandRegistry = Record<string, ServerIslandRenderer>;

export class ServerIslandConfigError extends Error {
  constructor() {
    super(
      "SERVER_ISLAND_SECRET is not set — server islands cannot be signed, so they are disabled",
    );
    this.name = "ServerIslandConfigError";
  }
}

export function isServerIslandConfigured(): boolean {
  return Boolean(config.serverIslandSecret);
}

/**
 * Signs a placeholder's payload.
 *
 * Throws rather than emitting an unsigned placeholder: a page that silently
 * rendered holes nobody could fill — or worse, holes anybody could fill — is a
 * far more confusing failure than a boot-time error.
 */
export function signServerIslandPayload(name: string, props: unknown): string {
  if (!isServerIslandConfigured()) throw new ServerIslandConfigError();

  const body = Buffer.from(JSON.stringify({ name, props }), "utf8").toString("base64url");
  return `${body}.${signWithRing(ring(), body)}`;
}

/** Returns the payload only when the signature checks out. */
export function verifyServerIslandPayload(token: string): ServerIslandPayload | null {
  if (!isServerIslandConfigured()) return null;

  // The first dot, not the last: the body is base64url and carries none, while
  // the signature after it is `<kid>.<digest>` and carries one.
  const separator = token.indexOf(".");
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!verifyWithRing(ring(), body, signature)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const { name, props } = parsed as ServerIslandPayload;
    return typeof name === "string" && name.length > 0 ? { name, props } : null;
  } catch {
    return null;
  }
}

/**
 * The ring, rebuilt per call rather than memoised.
 *
 * `keyRing` is two HMACs over a short string and the config is read anyway; a
 * cached ring would be one more thing to invalidate when a test changes the
 * secret, for a saving nothing can measure.
 */
function ring(): KeyRing {
  return keyRing(config.serverIslandSecret ?? "", config.serverIslandPreviousSecret);
}
