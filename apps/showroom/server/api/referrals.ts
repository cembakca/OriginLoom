import { config } from "@originloom/core/config";
import { applyCookies, CookieJar } from "@originloom/core/middleware/cookie-jar";
import { contextRequest } from "@originloom/core/middleware/request-deadline";
import type { AppVariables } from "@originloom/core/middleware/request-id";
import { sanitizeUuid } from "@originloom/core/middleware/sanitize";
import { guardPublicApi, type PublicApiPolicy } from "@originloom/core/security/public-api-guard";
import { normalizeNavigationUrl } from "@originloom/shared/lib/content-url";
import { isBoundedRouteSlug } from "@originloom/shared/lib/content-values";
import { Cookie } from "@originloom/shared/lib/cookies";
import { cookie } from "@originloom/shared/lib/request";
import { observeReferralRedirect } from "@server/metrics/referrals";
import { createReferral } from "@server/services/financial-products";
import type { Hono } from "hono";

import { referralProductByPublicType } from "~/lib/referral-products";

const REFERRAL_SESSION_MAX_AGE = 86_400 * 30;
const referralPolicy: PublicApiPolicy = {
  name: "referral",
  windowMs: 60_000,
  globalLimit: 1_000,
  ipLimit: 30,
  requireSameOriginMutation: true,
};

export async function handleReferralApi(
  request: Request,
  clientIp = "unresolved",
): Promise<Response> {
  const started = performance.now();
  let productType = "unknown";
  try {
    const denied = await guardPublicApi(request, clientIp, referralPolicy);
    if (denied) return denied;

    const form = await readForm(request);
    if (!form) return measuredError("Geçersiz başvuru isteği", 400, productType, started);
    const publicType = form.get("productType");
    const slug = form.get("slug");
    const definition =
      typeof publicType === "string" ? referralProductByPublicType(publicType) : undefined;
    productType = definition?.gatewayType ?? "unknown";
    if (!definition || typeof slug !== "string" || !isBoundedRouteSlug(slug)) {
      return measuredError("Geçersiz başvuru isteği", 400, productType, started);
    }

    const currentSession = sanitizeUuid(cookie(request, Cookie.referralSession));
    const anonymousSessionId = currentSession ?? crypto.randomUUID();
    const created = await createReferral(
      definition.gatewayType,
      slug,
      anonymousSessionId,
      request.signal,
    );
    if (!created) {
      observeReferralRedirect(productType, "unknown_product", performance.now() - started);
      return new Response("Ürün bulunamadı", { status: 404 });
    }
    const destination = normalizeNavigationUrl(created.redirectUrl, {
      siteUrl: config.siteUrl,
      external: true,
    });
    if (!destination) {
      observeReferralRedirect(productType, "unsafe_destination", performance.now() - started);
      return new Response("Güvenli yönlendirme oluşturulamadı", {
        status: 502,
        headers: { "cache-control": "private, no-store" },
      });
    }

    const durationMs = performance.now() - started;
    observeReferralRedirect(
      productType,
      "issued",
      durationMs,
      created.measurement.gatewayProcessingMs,
    );
    const response = new Response(null, {
      status: 303,
      headers: {
        location: destination,
        "cache-control": "private, no-store",
        "server-timing": `referral;dur=${durationMs.toFixed(1)}, gateway-ticket;dur=${created.measurement.gatewayProcessingMs.toFixed(1)}`,
      },
    });
    if (currentSession) return response;

    const cookies = new CookieJar();
    cookies.set(Cookie.referralSession, anonymousSessionId, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      maxAge: REFERRAL_SESSION_MAX_AGE,
    });
    return applyCookies(response, cookies);
  } catch (error) {
    observeReferralRedirect(productType, "error", performance.now() - started);
    throw error;
  }
}

export function mountReferralApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/referrals", (c) => {
    c.set("requestRoute", "<api referral>");
    return handleReferralApi(contextRequest(c), c.get("clientIp") ?? "unresolved");
  });
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function measuredError(message: string, status: 400 | 403, productType: string, started: number) {
  observeReferralRedirect(productType, "invalid_request", performance.now() - started);
  return new Response(message, { status, headers: { "cache-control": "private, no-store" } });
}
