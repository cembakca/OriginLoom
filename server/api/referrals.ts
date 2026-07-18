import { config } from "@server/config";
import { observeReferralRedirect } from "@server/metrics";
import { applyCookies, CookieJar } from "@server/middleware/cookie-jar";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { sanitizeUuid } from "@server/middleware/sanitize";
import { createReferral } from "@server/services/financial-products";
import type { Hono } from "hono";

import { normalizeNavigationUrl } from "~/lib/content-url";
import { isBoundedRouteSlug } from "~/lib/content-values";
import { Cookie } from "~/lib/cookies";
import { referralProductByPublicType } from "~/lib/referral-products";
import { cookie } from "~/lib/request";

const REFERRAL_SESSION_MAX_AGE = 86_400 * 30;

export async function handleReferralApi(request: Request): Promise<Response> {
  const started = performance.now();
  let productType = "unknown";
  try {
    if (!isTrustedOrigin(request)) {
      return measuredError("Cross-origin başvuru isteği reddedildi", 403, productType, started);
    }

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
    return handleReferralApi(contextRequest(c));
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

function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(config.siteUrl).origin;
  } catch {
    return false;
  }
}
