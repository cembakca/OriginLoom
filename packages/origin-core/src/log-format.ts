type LogLevel = "info" | "warn" | "error" | "debug";

type LogFields = Record<string, unknown>;

const PRETTY_SKIP = new Set(["service", "releaseId"]);

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

function paint(text: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

function levelStyle(level: LogLevel, enabled: boolean): string {
  const label = level.toUpperCase().padEnd(5);
  switch (level) {
    case "error":
      return paint(label, ANSI.red, enabled);
    case "warn":
      return paint(label, ANSI.yellow, enabled);
    case "debug":
      return paint(label, ANSI.gray, enabled);
    default:
      return paint(label, ANSI.cyan, enabled);
  }
}

function statusStyle(status: number, enabled: boolean): string {
  const text = String(status);
  if (status >= 500) return paint(text, ANSI.red, enabled);
  if (status >= 400) return paint(text, ANSI.yellow, enabled);
  if (status >= 300) return paint(text, ANSI.blue, enabled);
  return paint(text, ANSI.green, enabled);
}

function cacheStyle(cache: string, enabled: boolean): string {
  if (cache === "HIT") return paint(cache, ANSI.green, enabled);
  if (cache === "MISS") return paint(cache, ANSI.yellow, enabled);
  if (cache === "ERROR") return paint(cache, ANSI.red, enabled);
  return paint(cache, ANSI.gray, enabled);
}

function shortRequestId(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.length <= 8 ? value : `${value.slice(0, 8)}…`;
}

function formatFieldValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.includes(" ") ? `"${value}"` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatRequestLine(fields: LogFields, color: boolean): string {
  const path = typeof fields.path === "string" ? fields.path : "/";
  const status = typeof fields.status === "number" ? fields.status : 0;
  const cache = typeof fields.cache === "string" ? fields.cache : "—";
  const durationMs = typeof fields.durationMs === "number" ? fields.durationMs : 0;
  const requestId = shortRequestId(fields.requestId);
  const parts = [
    paint(path, ANSI.bold, color),
    statusStyle(status, color),
    cacheStyle(cache, color),
    paint(`${durationMs}ms`, ANSI.dim, color),
  ];
  if (requestId) parts.push(paint(`req=${requestId}`, ANSI.gray, color));
  return parts.join(" ");
}

function formatTail(fields: LogFields): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (PRETTY_SKIP.has(key)) continue;
    parts.push(`${key}=${formatFieldValue(value)}`);
  }
  return parts.join(" ");
}

export function formatPrettyLog(
  level: LogLevel,
  msg: string,
  fields: LogFields,
  time = new Date(),
): string {
  const color = process.stdout.isTTY === true;
  const clock = paint(
    time.toLocaleTimeString("en-GB", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + `.${String(time.getMilliseconds()).padStart(3, "0")}`,
    ANSI.dim,
    color,
  );
  const headline = paint(msg, ANSI.bold, color);

  if (msg === "request" && typeof fields.path === "string") {
    return `${clock} ${levelStyle(level, color)} ${headline} ${formatRequestLine(fields, color)}`;
  }

  if (msg === "client runtime error") {
    const parts = [
      typeof fields.errorId === "string"
        ? paint(`errorId=${fields.errorId}`, ANSI.bold, color)
        : undefined,
      typeof fields.pageRequestId === "string"
        ? paint(
            `page=${shortRequestId(fields.pageRequestId) ?? fields.pageRequestId}`,
            ANSI.cyan,
            color,
          )
        : undefined,
      typeof fields.requestId === "string"
        ? paint(
            `telemetry=${shortRequestId(fields.requestId) ?? fields.requestId}`,
            ANSI.gray,
            color,
          )
        : undefined,
      typeof fields.source === "string"
        ? paint(String(fields.source), ANSI.yellow, color)
        : undefined,
      typeof fields.path === "string" ? paint(String(fields.path), ANSI.bold, color) : undefined,
    ].filter(Boolean);
    return `${clock} ${levelStyle(level, color)} ${headline} ${parts.join(" ")}`;
  }

  const tail = formatTail(fields);
  return tail.length > 0
    ? `${clock} ${levelStyle(level, color)} ${headline}  ${tail}`
    : `${clock} ${levelStyle(level, color)} ${headline}`;
}
