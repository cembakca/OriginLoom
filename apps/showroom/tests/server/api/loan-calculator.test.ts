import { handleLoanCalculatorApi } from "@server/api/loan-calculator";
import { describe, expect, it } from "vitest";

describe("loan calculator BFF", () => {
  it("returns the authoritative gateway calculation with private cache headers", async () => {
    const response = await handleLoanCalculatorApi(
      new Request("http://localhost/api/finance/loan-calculation?amount=1250000&term=48&rate=2.5"),
    );
    const body = (await response.json()) as {
      calculationVersion: string;
      input: { amount: number; term: number };
      result: { paymentPlan: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({
      calculationVersion: "housing-annuity-v1",
      input: { amount: 1_250_000, term: 48 },
    });
    expect(body.result.paymentPlan).toHaveLength(48);
  });

  it("rejects malformed, unsupported and out-of-range input before the gateway", async () => {
    const responses = await Promise.all([
      handleLoanCalculatorApi(
        new Request("http://localhost/api/finance/loan-calculation?amount=abc"),
      ),
      handleLoanCalculatorApi(new Request("http://localhost/api/finance/loan-calculation?term=13")),
      handleLoanCalculatorApi(new Request("http://localhost/api/finance/loan-calculation?rate=99")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
  });
});
