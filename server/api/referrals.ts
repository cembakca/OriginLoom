import { config } from "@server/config";
import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { createReferral } from "@server/services/financial-products";
import type { Hono } from "hono";

import { normalizeNavigationUrl } from "~/lib/content-url";

const PUBLIC_PRODUCT_TYPES: Record<string, string> = {
  "konut-kredisi": "housing-loan",
  "kredi-karti": "credit-card",
};

export async function handleReferralApi(request: Request): Promise<Response> {
  const form = await request.formData();
  const publicType = form.get("productType");
  const slug = form.get("slug");
  const consent = form.get("consent");
  const productType = typeof publicType === "string" ? PUBLIC_PRODUCT_TYPES[publicType] : undefined;
  if (!productType || typeof slug !== "string" || consent !== "accepted") {
    return new Response("Geçersiz başvuru isteği", { status: 400 });
  }

  const created = await createReferral(productType, slug, request.signal);
  if (!created) return new Response("Ürün bulunamadı", { status: 404 });
  const destination = normalizeNavigationUrl(created.redirectUrl, {
    siteUrl: config.siteUrl,
    external: true,
  });
  if (!destination) throw new Error("Referral gateway returned an unsafe redirect URL");
  return new Response(null, {
    status: 303,
    headers: { location: destination, "cache-control": "private, no-store" },
  });
}

export function mountReferralApi(app: Hono<{ Variables: AppVariables }>): void {
  app.post("/api/referrals", (c) => handleReferralApi(contextRequest(c)));
}
