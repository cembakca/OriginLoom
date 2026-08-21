import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { RouteErrorBoundaryProps } from "@originloom/shared/lib/types";
import type { ComponentType, ReactElement, ReactNode } from "react";

export type CriticalPaintConfig = {
  backgroundColor?: string;
  color?: string;
  colorScheme?: "light" | "dark";
  themeColor?: string;
};

/**
 * The product's document chrome, in React terms. This is the half of the old
 * `DocumentShell` that could never be framework-neutral: components and head
 * slots. The neutral half (language, bot detection, metadata) stays on
 * `OriginRuntime.document`.
 */
export type ReactRendererConfig<Shell = unknown> = {
  NotFoundComponent: ComponentType;
  ErrorComponent: ComponentType<RouteErrorBoundaryProps>;
  /**
   * First-paint colors inlined before external CSS. Prevents a black/white flash
   * on reload and enables same-origin cross-document view transitions.
   */
  criticalPaint?: CriticalPaintConfig;
  renderHeadStart: (args: { seo: ResolvedMetadata; cspNonce?: string | undefined }) => ReactNode;
  renderHeadEnd: (args: { cspNonce?: string | undefined; isBot: boolean }) => ReactNode;
  renderLayout: (args: {
    shell: Shell;
    pageMeta: PageAnalyticsMeta;
    children: ReactNode;
  }) => ReactElement;
  /**
   * Dev-only React Refresh runtime URL. Defaults to `/@react-refresh` on the
   * Vite dev-server origin, derived from `assets.development.client`.
   */
  refreshRuntimeUrl?: (development: { client: string }) => string;
};
