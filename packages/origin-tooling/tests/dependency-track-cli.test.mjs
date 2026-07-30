import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../bin/dependency-track.mjs");
const execFileAsync = promisify(execFile);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("origin-dependency-track", () => {
  it("uploads a CycloneDX BOM, waits for analysis and passes the configured gate", async () => {
    const root = fixtureRoot();
    const fake = await startDependencyTrack({
      findings: [{ vulnerability: { severity: "HIGH" } }],
      violations: [{ policy: { violationState: "WARN" } }],
    });

    try {
      const result = await run(root, fake.url, "publish");
      expect(result.stdout).toContain("BOM processing completed");
      expect(result.stdout).toContain("gate PASSED");
      expect(result.stdout).toContain("high=1");
      expect(result.stdout).not.toContain("test-api-key");
      expect(fake.requests.map(({ path }) => path)).toEqual([
        "/api/v1/bom",
        "/api/v1/event/token/upload-token",
        "/api/v1/event/token/upload-token",
        "/api/v1/project/lookup?name=example-app&version=1.2.3",
        "/api/v1/finding/project/project-uuid?suppressed=false&pageNumber=1&pageSize=500",
        "/api/v1/violation/project/project-uuid?suppressed=false&pageNumber=1&pageSize=500",
      ]);
      expect(fake.requests[0].apiKey).toBe("test-api-key");
      expect(fake.requests[0].body).toContain('name="projectName"');
      expect(fake.requests[0].body).toContain("example-app");
      expect(fake.requests[0].body).toContain('filename="bom.cdx.json"');
    } finally {
      await fake.close();
    }
  });

  it("fails on unsuppressed findings at or above the severity threshold", async () => {
    const root = fixtureRoot();
    const fake = await startDependencyTrack({
      findings: [{ vulnerability: { severity: "CRITICAL" } }],
      violations: [],
    });

    try {
      await expect(run(root, fake.url, "publish")).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining("gate FAILED"),
      });
    } finally {
      await fake.close();
    }
  });

  it("reads every Dependency-Track result page before deciding the gate", async () => {
    const root = fixtureRoot();
    const findings = Array.from({ length: 501 }, (_, index) => ({
      vulnerability: { severity: index === 500 ? "CRITICAL" : "LOW" },
    }));
    const fake = await startDependencyTrack({ findings, violations: [] });

    try {
      await expect(run(root, fake.url, "publish")).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining("gate FAILED"),
      });
      expect(fake.requests.map(({ path }) => path)).toContain(
        "/api/v1/finding/project/project-uuid?suppressed=false&pageNumber=2&pageSize=500",
      );
    } finally {
      await fake.close();
    }
  });

  it("reports a missing API key without attempting network access", async () => {
    const root = fixtureRoot();
    await expect(
      execFileAsync(process.execPath, [CLI, "gate"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, DEPENDENCY_TRACK_URL: "http://127.0.0.1:1" },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("DEPENDENCY_TRACK_API_KEY is required"),
    });
  });
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "originloom-dtrack-"));
  roots.push(root);
  mkdirSync(join(root, "artifacts/sbom"), { recursive: true });
  writeJson(join(root, "package.json"), { name: "example-app", version: "1.2.3" });
  writeJson(join(root, "dependency-track.config.json"), {
    bomPath: "artifacts/sbom/bom.cdx.json",
    autoCreate: true,
    isLatest: true,
    tags: ["originloom"],
    gate: {
      failOnSeverity: "critical",
      failOnPolicyViolation: "fail",
      timeoutSeconds: 2,
      pollIntervalSeconds: 0.01,
    },
  });
  writeJson(join(root, "artifacts/sbom/bom.cdx.json"), {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    metadata: { component: { type: "application", name: "example-app", version: "1.2.3" } },
    components: [],
  });
  return root;
}

async function run(root, url, command) {
  return execFileAsync(process.execPath, [CLI, command], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DEPENDENCY_TRACK_URL: url,
      DEPENDENCY_TRACK_API_KEY: "test-api-key",
    },
  });
}

async function startDependencyTrack({ findings, violations }) {
  const requests = [];
  let tokenChecks = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const path = request.url;
    requests.push({ path, body, apiKey: request.headers["x-api-key"] });

    if (path === "/api/v1/bom" && request.method === "POST") {
      return json(response, 200, { token: "upload-token" });
    }
    if (path === "/api/v1/event/token/upload-token") {
      tokenChecks += 1;
      return json(response, 200, { processing: tokenChecks === 1 });
    }
    if (path === "/api/v1/project/lookup?name=example-app&version=1.2.3") {
      return json(response, 200, { uuid: "project-uuid" });
    }
    if (path.startsWith("/api/v1/finding/project/project-uuid?suppressed=false&")) {
      return paginated(response, path, findings);
    }
    if (path.startsWith("/api/v1/violation/project/project-uuid?suppressed=false&")) {
      return paginated(response, path, violations);
    }
    return json(response, 404, { error: "not found" });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function paginated(response, path, items) {
  const url = new URL(path, "http://dependency-track.test");
  const pageNumber = Number(url.searchParams.get("pageNumber"));
  const pageSize = Number(url.searchParams.get("pageSize"));
  const start = (pageNumber - 1) * pageSize;
  return json(response, 200, items.slice(start, start + pageSize), {
    "x-total-count": String(items.length),
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
