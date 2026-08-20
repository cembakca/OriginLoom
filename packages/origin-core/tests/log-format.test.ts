import { describe, expect, it } from "vitest";

import { formatPrettyLog } from "../src/log-format.js";

describe("formatPrettyLog", () => {
  it("formats request logs with path, status, cache and duration", () => {
    const line = formatPrettyLog(
      "info",
      "request",
      {
        path: "/",
        status: 200,
        cache: "MISS",
        durationMs: 381,
        requestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
        service: "origin-loom",
        releaseId: "development",
      },
      new Date("2026-08-20T14:46:42.965Z"),
    );

    expect(line).toContain("request");
    expect(line).toContain("/");
    expect(line).toContain("200");
    expect(line).toContain("MISS");
    expect(line).toContain("381ms");
    expect(line).toContain("req=1ee4a9e7");
    expect(line).not.toContain("origin-loom");
    expect(line).not.toContain("development");
  });

  it("formats generic logs without service noise", () => {
    const line = formatPrettyLog(
      "info",
      "server started",
      { port: 3010, cacheTopology: "memory", tracingEnabled: false, service: "origin-loom" },
      new Date("2026-08-20T14:46:41.832Z"),
    );

    expect(line).toContain("server started");
    expect(line).toContain("port=3010");
    expect(line).toContain("cacheTopology=memory");
    expect(line).not.toContain("service=");
  });

  it("formats client runtime errors with page and telemetry request ids", () => {
    const line = formatPrettyLog(
      "warn",
      "client runtime error",
      {
        errorId: "client-123",
        pageRequestId: "1ee4a9e7-4502-436c-8518-40cdbe1b1171",
        requestId: "telemetry-request",
        source: "island-mount",
        path: "/catalog",
      },
      new Date("2026-08-20T14:46:43.201Z"),
    );

    expect(line).toContain("client runtime error");
    expect(line).toContain("errorId=client-123");
    expect(line).toContain("page=1ee4a9e7");
    expect(line).toContain("telemetry=telemetr");
    expect(line).toContain("/catalog");
  });
});
