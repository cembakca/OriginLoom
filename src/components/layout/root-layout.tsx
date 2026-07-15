import type { ReactNode } from "react";

import { Container } from "~/components/ui/container";
import type { PageAnalyticsMeta } from "~/lib/analytics/types";
import { Island } from "~/lib/island";
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

  return (
    <div className="flex min-h-screen flex-col">
      {showChrome ? <Header menu={shell.menu!} deviceType={shell.deviceType} /> : null}

      <Island name="layout-client" mode="defer" eager props={shell} />

      <main id="page-main" className="flex-1 py-8">
        <Container>{children}</Container>
      </main>

      {showChrome ? <Footer menu={shell.menu!} deviceType={shell.deviceType} /> : null}

      <Island name="page-analytics" mode="defer" eager props={pageMeta} />
    </div>
  );
}
