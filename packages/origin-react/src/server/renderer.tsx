/** @jsxRuntime automatic */ /** @jsxImportSource react */
import type { RouteError } from "@originloom/shared/lib/types";
import type {
  DocumentRenderInput,
  DocumentStreamOptions,
  FrameworkNode,
  OriginRenderer,
  StreamResult,
} from "@originloom/shared/render";
import type { ComponentType, ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { DocumentLayout } from "./document-layout.js";
import { renderTreeToStream } from "./stream.js";
import type { ReactRendererConfig } from "./types.js";

/**
 * The React implementation of the render contract. Install it on the runtime
 * (`OriginRuntime.renderer`) and the server core never touches React itself.
 *
 * Framework values cross the seam as the opaque `FrameworkNode`, so this is the
 * one place that narrows them back to React types.
 */
export function createReactRenderer<Shell>(
  config: ReactRendererConfig<Shell>,
): OriginRenderer<Shell> {
  return {
    routeContent<T>(route: { Component: (props: { data: T }) => FrameworkNode }, data: T) {
      const Component = route.Component as ComponentType<{ data: T }>;
      return <Component data={data} />;
    },

    notFoundContent(_ctx, route) {
      const Component = (route?.NotFoundComponent ?? config.NotFoundComponent) as ComponentType;
      return <Component />;
    },

    errorContent(_ctx, route, error: RouteError | null, status: number) {
      const Component = (route.ErrorComponent ?? config.ErrorComponent) as ComponentType<{
        error: RouteError | null;
        status: number;
      }>;
      return <Component error={error} status={status} />;
    },

    renderNode(node: FrameworkNode) {
      return renderToString(node as ReactElement);
    },

    renderDocument(input: DocumentRenderInput<Shell>) {
      return "<!DOCTYPE html>" + renderToString(<DocumentLayout input={input} config={config} />);
    },

    renderDocumentToStream(
      input: DocumentRenderInput<Shell>,
      options: DocumentStreamOptions,
    ): Promise<StreamResult> {
      return renderTreeToStream(<DocumentLayout input={input} config={config} />, {
        ...options,
        cspNonce: input.cspNonce,
      });
    },
  };
}
