import { Island } from "@originloom/react/lib/island";
import type { PageAnalyticsMeta } from "@originloom/shared/lib/analytics/types";
import type { ReactNode } from "react";

import { Container } from "~/components/ui/container";
import type { ShellData } from "~/lib/shell-data";

import { Footer } from "./footer";
import { Header } from "./header";

export type RootLayoutProps = {
  shell: ShellData;
  pageMeta: PageAnalyticsMeta;
  children: ReactNode;
};

/** Application shell — menu SSR + Radix islands for interactivity. */
export function RootLayout({ shell, pageMeta, children }: RootLayoutProps) {
  const showChrome = !shell.minimalChrome && shell.menu;
  const { menu, ...shellClientProps } = shell;

  return (
    <div className="flex min-h-screen flex-col">
      {showChrome ? (
        <ssr-fragment name="header" style={{ display: "contents" }}>
          <Header menu={menu!} deviceType={shell.deviceType} />
        </ssr-fragment>
      ) : null}

      <Island name="layout-client" mode="defer" eager props={shellClientProps} />

      {/* Named so a navigation morphs the content and leaves the chrome alone.
          One element per value per document — a duplicate makes the browser skip
          the transition. The name belongs on the element that draws the box, not
          on the stitching wrapper around it: `ssr-fragment` is `display: contents`
          and generates no principal box, so a name on it is inert. The header and
          footer names live on their own `<header>`/`<footer>`. See
          @originloom/react's critical paint CSS. */}
      <main id="page-main" data-view-transition="main" className="flex-1 py-8">
        <Container>{children}</Container>
      </main>

      {showChrome ? (
        <ssr-fragment name="footer" style={{ display: "contents" }}>
          <Footer menu={menu!} deviceType={shell.deviceType} />
        </ssr-fragment>
      ) : null}

      <Island name="page-analytics" mode="defer" eager props={pageMeta} />
    </div>
  );
}
