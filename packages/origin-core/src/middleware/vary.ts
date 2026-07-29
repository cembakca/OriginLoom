/** Adds one case-insensitive Vary token without discarding existing dimensions. */
export function appendVary(current: string | null, value: string): string {
  if (!current) return value;
  const entries = current.split(",").map((entry) => entry.trim());
  return entries.some((entry) => entry.toLowerCase() === value.toLowerCase())
    ? current
    : `${current}, ${value}`;
}
