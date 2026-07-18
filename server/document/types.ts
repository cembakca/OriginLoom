import type { Assets } from "@server/assets";
import type { ReactElement } from "react";

import type { PageAnalyticsMeta } from "~/lib/analytics/types";
import type { ImagePreload } from "~/lib/media";
import type { ResolvedMetadata } from "~/lib/metadata/types";
import type { ShellData } from "~/lib/shell-data";
import type { Ctx } from "~/lib/types";

export type DocumentContext = { routeCtx: Ctx };

export type StreamResult = {
  stream: ReadableStream<Uint8Array>;
  abort: () => void;
  allReady: Promise<void>;
};

export type DocumentLayoutProps = {
  seo: ResolvedMetadata;
  assets: Assets;
  preconnectOrigins: string[];
  imagePreloads: ImagePreload[];
  modulePreloads: string[];
  isBot: boolean;
  shell: ShellData;
  pageMeta: PageAnalyticsMeta;
  content: ReactElement;
};
