import { contextRequest } from "@server/middleware/request-deadline";
import type { AppVariables } from "@server/middleware/request-id";
import { guardPublicApi, type PublicApiPolicy } from "@server/security/public-api-guard";
import { getLoanCalculation } from "@server/services/financial-products";
import type { Hono } from "hono";

import { parseLoanCalculatorSearch } from "~/lib/loan-calculator-query";

const loanCalculatorPolicy: PublicApiPolicy = {
  name: "loan-calculation",
  windowMs: 60_000,
  globalLimit: 2_000,
  ipLimit: 120,
};

export async function handleLoanCalculatorApi(
  request: Request,
  clientIp = "unresolved",
): Promise<Response> {
  const denied = await guardPublicApi(request, clientIp, loanCalculatorPolicy);
  if (denied) return denied;
  const search = parseLoanCalculatorSearch(new URL(request.url).searchParams);
  if (!search) return json({ error: "Geçersiz hesaplama parametreleri" }, 400);
  const data = await getLoanCalculation(search, request.signal);
  return json(data, 200);
}

export function mountLoanCalculatorApi(app: Hono<{ Variables: AppVariables }>): void {
  app.get("/api/finance/loan-calculation", (c) => {
    c.set("requestRoute", "<api loan-calculation>");
    return handleLoanCalculatorApi(contextRequest(c), c.get("clientIp") ?? "unresolved");
  });
}

function json(data: unknown, status: 200 | 400): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
