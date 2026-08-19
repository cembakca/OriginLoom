import type { CriticalPaintConfig } from "./types.js";

export const DEFAULT_CRITICAL_PAINT: Required<CriticalPaintConfig> = {
  backgroundColor: "#f8fafc",
  color: "#0f172a",
  colorScheme: "light",
  themeColor: "#f8fafc",
};

/** Inline head styles so the first paint is not a blank/dark canvas before Tailwind loads. */
export function criticalPaintCss(config: CriticalPaintConfig = {}): string {
  const paint = { ...DEFAULT_CRITICAL_PAINT, ...config };
  return [
    `html,body{background-color:${paint.backgroundColor};color:${paint.color};margin:0}`,
    "body{min-height:100vh}",
    "#root{min-height:100vh}",
    "@view-transition{navigation:auto}",
    "::view-transition-old(root),::view-transition-new(root){animation-duration:.15s}",
  ].join("");
}
