/**
 * Preserves incoming query values while letting explicit destination values
 * replace every incoming value with the same key.
 */
export function mergeSearchParams(incoming: URLSearchParams, destination: URLSearchParams): string {
  const merged = new URLSearchParams(incoming);
  const destinationKeys = new Set(destination.keys());

  for (const key of destinationKeys) merged.delete(key);
  for (const [key, value] of destination) merged.append(key, value);

  return merged.toString();
}
