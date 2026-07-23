import { cn } from "@originloom/react/lib/utils";

import { buttonVariants } from "~/components/ui/button";
import { referralProductByGatewayType } from "~/lib/referral-products";

export function ReferralCta({
  productType,
  slug,
  label = "Bankada başvur",
  size = "default",
  className,
}: {
  productType: string;
  slug: string;
  label?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const definition = referralProductByGatewayType(productType);
  if (!definition) throw new Error(`Referral product type is not registered: ${productType}`);

  return (
    <form method="post" action="/api/referrals" className={cn("inline-flex", className)}>
      <input type="hidden" name="productType" value={definition.publicType} />
      <input type="hidden" name="slug" value={slug} />
      <button className={cn(buttonVariants({ size }), "w-full")} type="submit">
        {label}
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
