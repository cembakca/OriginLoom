import type { ReactNode } from "react";
import { Island } from "../../lib/island";
import type { ShellData } from "../../lib/shell-data";
import type { PageAnalyticsMeta } from "../../lib/analytics/types";
import { Header } from "./header";
import { Footer } from "./footer";

export type RootLayoutProps = {
  shell: ShellData;
  pageMeta: PageAnalyticsMeta;
  children: ReactNode;
};

/**
 * Application shell — menu SSR (Header/Footer), auth client island.
 * GTM bootstrap lives in document head.
 */
export function RootLayout({ shell, pageMeta, children }: RootLayoutProps) {
  const showChrome = !shell.minimalChrome && shell.menu;

  return (
    <>
      {showChrome ? <Header menu={shell.menu!} deviceType={shell.deviceType} /> : null}

      <Island name="layout-client" mode="defer" eager props={shell} />

      <main id="page-main">{children}</main>

      {showChrome ? <Footer menu={shell.menu!} deviceType={shell.deviceType} /> : null}

      <Island name="page-analytics" mode="defer" eager props={pageMeta} />
    </>
  );
}
