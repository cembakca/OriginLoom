import { AsyncLocalStorage } from "node:async_hooks";

import {
  type Attributes,
  type Context,
  context,
  propagation,
  type Span,
  SpanKind,
  type SpanOptions as OtelSpanOptions,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

const tracer = trace.getTracer("origin-loom");
const REQUEST_ID_BAGGAGE_KEY = "ssr.request_id";
const requestStorage = new AsyncLocalStorage<string>();

export type AppSpanOptions = {
  attributes?: Attributes;
  kind?: SpanKind;
  parent?: Context;
};

export async function withSpan<T>(
  name: string,
  options: AppSpanOptions,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const spanOptions: OtelSpanOptions = {};
  if (options.attributes) spanOptions.attributes = options.attributes;
  if (options.kind !== undefined) spanOptions.kind = options.kind;

  const run = async (span: Span): Promise<T> => {
    try {
      return await work(span);
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  };
  return tracer.startActiveSpan(name, spanOptions, options.parent ?? context.active(), run);
}

export async function withRequestSpan<T>(
  request: Request,
  requestId: string,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const extracted = propagation.extract(context.active(), request.headers, {
    get: (headers, key) => headers.get(key) ?? undefined,
    keys: (headers) => [...headers.keys()],
  });
  const baggage = (propagation.getBaggage(extracted) ?? propagation.createBaggage()).setEntry(
    REQUEST_ID_BAGGAGE_KEY,
    { value: requestId },
  );
  const parent = propagation.setBaggage(extracted, baggage);
  const url = new URL(request.url);

  return requestStorage.run(requestId, () =>
    withSpan(
      `${request.method} ${url.pathname}`,
      {
        parent,
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": request.method,
          "url.path": url.pathname,
          "url.scheme": url.protocol.slice(0, -1),
          "server.address": url.hostname,
          "ssr.request_id": requestId,
        },
      },
      work,
    ),
  );
}

export function injectActiveTrace(headers: Headers): void {
  propagation.inject(context.active(), headers, {
    set: (carrier, key, value) => carrier.set(key, value),
  });
}

export function activeRequestId(): string | undefined {
  return (
    requestStorage.getStore() ??
    propagation.getBaggage(context.active())?.getEntry(REQUEST_ID_BAGGAGE_KEY)?.value
  );
}

export function activeTraceFields(): { traceId?: string; spanId?: string } {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export function setActiveHttpRoute(method: string, route: string): void {
  const span = trace.getSpan(context.active());
  span?.updateName(`${method} ${route}`);
  span?.setAttribute("http.route", route);
}

export function recordSpanError(span: Span, error: unknown): void {
  if (error instanceof Error) span.recordException(error);
  else span.recordException(String(error));
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { SpanKind, SpanStatusCode };
