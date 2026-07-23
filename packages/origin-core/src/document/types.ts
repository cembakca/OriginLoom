import type { PageAnalyticsMeta } from "@originloom/react/lib/analytics/types";
import type { ImagePreload } from "@originloom/react/lib/media";
import type { ResolvedMetadata } from "@originloom/react/lib/metadata/types";
import type { Ctx } from "@originloom/react/lib/types";
import type { ReactElement } from "react";

import type { Assets } from "../assets";

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
  shell: unknown;
  pageMeta: PageAnalyticsMeta;
  content: ReactElement;
  cspNonce?: string | undefined;
};
