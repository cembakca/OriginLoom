export type CspSourceOrigins = {
  asset: string[];
  image: string[];
};

export function resolveCspSourceOrigins(input: {
  assetCdnUrl: string | undefined;
  imageCdnUrl: string | undefined;
  imageTransformUrl: string | undefined;
}): CspSourceOrigins {
  return {
    asset: uniqueOrigins([input.assetCdnUrl]),
    image: uniqueOrigins([input.assetCdnUrl, input.imageCdnUrl, input.imageTransformUrl]),
  };
}

function uniqueOrigins(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => Boolean(value))
        .map((value) => new URL(value).origin),
    ),
  ];
}
