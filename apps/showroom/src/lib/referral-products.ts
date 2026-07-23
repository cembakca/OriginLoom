export type ReferralProductDefinition = {
  publicType: string;
  gatewayType: string;
};

const definitions: readonly ReferralProductDefinition[] = [
  { publicType: "konut-kredisi", gatewayType: "housing-loan" },
  { publicType: "kredi-karti", gatewayType: "credit-card" },
];

const byPublicType = new Map(definitions.map((definition) => [definition.publicType, definition]));
const byGatewayType = new Map(
  definitions.map((definition) => [definition.gatewayType, definition]),
);

export function referralProductByPublicType(value: string | undefined) {
  return value ? byPublicType.get(value) : undefined;
}

export function referralProductByGatewayType(value: string | undefined) {
  return value ? byGatewayType.get(value) : undefined;
}
