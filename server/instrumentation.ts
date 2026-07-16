import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

const serviceName = process.env.OTEL_SERVICE_NAME ?? "ssr-kit";
const releaseId = process.env.RELEASE_ID ?? "development";

let sdk: NodeSDK | undefined;
let registered = false;

/**
 * Process başına bir kez çağrılan observability lifecycle noktası.
 * OTLP endpoint tanımlı değilse API no-op kalır; /metrics yine çalışır.
 */
export function register(): boolean {
  if (registered) return Boolean(sdk);
  registered = true;

  const exporter = process.env.OTEL_TRACES_EXPORTER ?? "otlp";
  const hasEndpoint = Boolean(
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
  if (process.env.OTEL_SDK_DISABLED === "true" || exporter === "none" || !hasEndpoint) {
    return false;
  }
  if (exporter !== "otlp") {
    throw new Error(`Unsupported OTEL_TRACES_EXPORTER: ${exporter}`);
  }

  sdk = new NodeSDK({
    resource: defaultResource().merge(
      resourceFromAttributes({
        "service.name": serviceName,
        "service.version": releaseId,
        "deployment.environment.name": process.env.NODE_ENV ?? "development",
      }),
    ),
    traceExporter: new OTLPTraceExporter(),
    // Prometheus-compatible application/process metrics are exposed by /metrics.
    metricReaders: [],
  });
  sdk.start();
  return true;
}

export async function shutdownInstrumentation(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  if (current) await current.shutdown();
}
