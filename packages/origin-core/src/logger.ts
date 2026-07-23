import { activeTraceFields } from "./observability";

type LogLevel = "info" | "warn" | "error" | "debug";

type LogFields = Record<string, unknown>;

function write(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    service: process.env.OTEL_SERVICE_NAME ?? "origin-loom",
    releaseId: process.env.RELEASE_ID ?? "development",
    ...activeTraceFields(),
    ...fields,
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
};

export function logError(err: unknown, fields: LogFields = {}): void {
  if (err instanceof Error) {
    logger.error(err.message, { ...fields, stack: err.stack, name: err.name });
    return;
  }
  logger.error("Unknown error", { ...fields, err: String(err) });
}
