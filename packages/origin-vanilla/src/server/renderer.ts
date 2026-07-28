import type {
  DocumentRenderInput,
  FrameworkNode,
  OriginRenderer,
  StreamResult,
} from "@originloom/shared/render";

import type { HtmlNode } from "../html.js";
import { documentLayout } from "./document-layout.js";
import type { HtmlRendererConfig } from "./types.js";

/**
 * A renderer with no UI framework behind it: route components return HTML nodes
 * built with the `html` tagged template, and this turns them into the response.
 *
 * Install it on the runtime (`OriginRuntime.renderer`) exactly like the React
 * adapter — the server core cannot tell the difference.
 */
export function createHtmlRenderer<Shell>(
  config: HtmlRendererConfig<Shell>,
): OriginRenderer<Shell> {
  const renderDocument = (input: DocumentRenderInput<Shell>): string =>
    documentLayout(input, config).html;

  return {
    routeContent<T>(route: { Component: (props: { data: T }) => FrameworkNode }, data: T) {
      return route.Component({ data });
    },

    notFoundContent(_ctx, route) {
      return route?.NotFoundComponent?.() ?? config.notFoundPage();
    },

    errorContent(_ctx, route, error, status) {
      return route.ErrorComponent?.({ error, status }) ?? config.errorPage({ error, status });
    },

    renderNode(node: FrameworkNode) {
      return (node as HtmlNode).html;
    },

    renderDocument,

    /**
     * There are no deferred boundaries to wait for, so the document is complete
     * the moment it is built: one chunk, already-resolved `allReady`. A route
     * marked `streaming: true` still works — it simply has nothing to defer.
     */
    renderDocumentToStream(input: DocumentRenderInput<Shell>): Promise<StreamResult> {
      const html = renderDocument(input);
      return Promise.resolve({
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(html));
            controller.close();
          },
        }),
        abort: () => undefined,
        allReady: Promise.resolve(),
      });
    },
  };
}
