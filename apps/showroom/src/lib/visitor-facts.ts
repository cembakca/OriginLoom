import { Cookie } from "@originloom/shared/lib/cookies";
import { deviceCacheFragment } from "@originloom/shared/lib/device";
import { cookie } from "@originloom/shared/lib/request";

/**
 * The per-visitor facts a server island may show.
 *
 * Deliberately small and deliberately not identity: this is what the demo needs
 * to prove the hole really is filled per request. Note what is *not* here — no
 * raw tracking id, no token. A server island renders into markup that ends up
 * in one visitor's DOM, so the same discipline applies as anywhere else: show
 * the fact, not the credential.
 */
export type VisitorFacts = {
  device: string;
  /** Whether this browser has been here before, not who it is. */
  returning: boolean;
  /** Rendered per request, which is the point — a cached shell cannot hold it. */
  renderedAt: string;
  language: string;
};

export function readVisitorFacts(request: Request): VisitorFacts {
  const tracking = cookie(request, Cookie.userTrackingId);
  return {
    device: deviceCacheFragment(request),
    returning: Boolean(tracking),
    renderedAt: new Date().toISOString(),
    language: (request.headers.get("accept-language") ?? "").split(",")[0]?.trim() || "bilinmiyor",
  };
}
