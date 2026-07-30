import type { Assets } from "./assets.js";
import type { PageAnalyticsMeta } from "./lib/analytics/types.js";
import type { ImagePreload } from "./lib/media.js";
import type { ResolvedMetadata } from "./lib/metadata/types.js";
import type { Ctx, Route, RouteError } from "./lib/types.js";

/**
 * A value produced by the UI framework — a React element, a Svelte component
 * payload, a string builder. The core only ever moves these around; the
 * installed renderer is the only thing allowed to look inside one.
 */
export type FrameworkNode = unknown;

export type StreamResult = {
  stream: ReadableStream<Uint8Array>;
  abort: () => void;
  allReady: Promise<void>;
};

/** Everything the core resolves before a document render. Framework-agnostic. */
export type DocumentRenderInput<Shell = unknown> = {
  htmlLang: string;
  /** Browser-visible path, before any rewrite. */
  publicPath: string;
  /** The query string the browser asked with, leading "?" included. */
  publicSearch: string;
  /** Public origin of this site. */
  siteUrl: string;
  assets: Assets;
  seo: ResolvedMetadata;
  pageMeta: PageAnalyticsMeta;
  shell: Shell;
  content: FrameworkNode;
  isBot: boolean;
  preconnectOrigins: readonly string[];
  imagePreloads: readonly ImagePreload[];
  modulePreloads: readonly string[];
  cspNonce?: string | undefined;
};

export type DocumentStreamOptions = {
  /** Called for errors raised inside deferred boundaries after the shell flushed. */
  onError: (error: unknown) => void;
};

/**
 * The UI-framework seam. `@originloom/react/server` implements it and
 * `@originloom/core` consumes it, so neither package has to import the other.
 *
 * Methods use shorthand syntax deliberately: their parameters compare
 * bivariantly, which keeps `OriginRenderer<Shell>` assignable to
 * `OriginRenderer<unknown>` when the runtime is installed.
 */
export interface OriginRenderer<Shell = unknown> {
  /** Wraps a route's component around its loaded data. */
  routeContent<T>(route: Route<T>, data: T, ctx: Ctx): FrameworkNode;
  notFoundContent(ctx: Ctx, route?: Route): FrameworkNode;
  errorContent(ctx: Ctx, route: Route, error: RouteError | null, status: number): FrameworkNode;
  /** Fragment / partial render — no doctype, no document chrome. */
  renderNode(node: FrameworkNode): string;
  /** The full document, `<!DOCTYPE html>` prefix included. */
  renderDocument(input: DocumentRenderInput<Shell>): string;
  /** Resolves once the shell is flushable; deferred content streams after it. */
  renderDocumentToStream(
    input: DocumentRenderInput<Shell>,
    options: DocumentStreamOptions,
  ): Promise<StreamResult>;
}
