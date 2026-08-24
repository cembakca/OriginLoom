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
    // Chrome only morphs an element between documents when both sides give it
    // the same name, and the chrome is the part that did not change: naming the
    // header and the main region stops them from cross-fading with the content
    // and makes a navigation read as the page changing rather than the site
    // being replaced.
    //
    // A name must be unique per document — two elements sharing one makes the
    // browser skip the whole transition, which degrades to today's behaviour
    // rather than breaking. Hence `data-view-transition`, one value per role.
    "[data-view-transition='header']{view-transition-name:ol-header}",
    "[data-view-transition='footer']{view-transition-name:ol-footer}",
    "[data-view-transition='main']{view-transition-name:ol-main}",
    // The root cross-fade shipped without this guard, so "reduce" still got an
    // animation. A view transition with no animation is an instant swap, which
    // is exactly what the preference asks for.
    "@media(prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}",
  ].join("");
}
