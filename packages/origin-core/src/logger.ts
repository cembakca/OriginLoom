import { config } from "./config.js";
import { activeTraceFields } from "./observability.js";

type LogLevel = "info" | "warn" | "error" | "debug";

type LogFields = Record<string, unknown>;
type LazyLogFields = LogFields | (() => LogFields);

const LEVEL_WEIGHT: Record<LogLevel | "silent", number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};
const configuredLevel = config.logLevel as LogLevel | "silent";
const baseFields = {
  service: process.env.OTEL_SERVICE_NAME ?? "origin-loom",
  releaseId: config.releaseId,
};

export function isLogEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[configuredLevel];
}

function write(level: LogLevel, msg: string, fields: LazyLogFields = {}): void {
  if (!isLogEnabled(level)) return;
  const resolvedFields = typeof fields === "function" ? fields() : fields;
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...baseFields,
    ...activeTraceFields(),
    ...resolvedFields,
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  isEnabled: isLogEnabled,
  info: (msg: string, fields?: LazyLogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LazyLogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LazyLogFields) => write("error", msg, fields),
  debug: (msg: string, fields?: LazyLogFields) => write("debug", msg, fields),
};

export function logError(err: unknown, fields: LogFields = {}): void {
  if (err instanceof Error) {
    logger.error(err.message, { ...fields, stack: err.stack, name: err.name });
    return;
  }
  logger.error("Unknown error", { ...fields, err: String(err) });
}
