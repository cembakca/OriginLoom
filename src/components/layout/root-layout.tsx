import type { ReactNode } from "react";
import { Island } from "../../lib/island";
import type { LayoutClientProps } from "../../lib/shell-data";
import type { PageAnalyticsMeta } from "../../lib/analytics/types";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

export type RootLayoutProps = {
  shell: LayoutClientProps;
  pageMeta: PageAnalyticsMeta;
  children: ReactNode;
};

/**
 * Application shell — GTM bootstrap lives in document head.
 * Chrome + stores: layout-client island (defer, eager).
 * Page view: page-analytics island (defer, eager) — after layout seeds stores.
 */
export function RootLayout({ shell, pageMeta, children }: RootLayoutProps) {
  return (
    <>
      <Island name="layout-client" mode="defer" eager props={shell}>
        <div data-chrome-fallback="">
          <SiteHeader />
        </div>
      </Island>

      <main id="page-main">{children}</main>

      <SiteFooter minimal={shell.minimalChrome} />

      <Island name="page-analytics" mode="defer" eager props={pageMeta} />
    </>
  );
}
