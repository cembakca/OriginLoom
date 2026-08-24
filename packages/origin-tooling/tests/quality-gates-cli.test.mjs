import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { startFakeGateway } from "./helpers/fake-gateway.mjs";

const CONTRACT_CLI = resolve(import.meta.dirname, "../bin/check-contracts.mjs");
const BUDGET_CLI = resolve(import.meta.dirname, "../bin/check-budgets.mjs");
const execFileAsync = promisify(execFile);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("quality gate CLIs", () => {
  /**
   * A menu is a tree and a comment is a thread: a schema that refers to itself
   * is a normal thing to write. Inlining every `$ref` to validate one — which is
   * what this did — recurses until the stack ends, and the failure looks like a
   * crash rather than a limitation.
   */
  it("validates a schema that refers to itself", () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "contracts/fixtures"), { recursive: true });
    writeJson(join(root, "contracts/gateway-schemas.json"), {
      $defs: {
        Node: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            children: { type: "array", items: { $ref: "#/$defs/Node" } },
          },
          additionalProperties: false,
        },
      },
    });
    writeJson(join(root, "contracts/gateway-contracts.json"), {
      schema: "gateway-schemas.json",
      contracts: [
        {
          id: "tree",
          path: "/tree",
          fixture: "fixtures/tree.json",
          schema: "#/$defs/Node",
        },
      ],
    });
    writeJson(join(root, "contracts/fixtures/tree.json"), {
      name: "root",
      children: [{ name: "child", children: [{ name: "grandchild" }] }],
    });

    const ok = run(CONTRACT_CLI, root);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("✓ tree");

    // And it still catches drift three levels down, rather than stopping at the
    // first ref it cannot follow.
    writeJson(join(root, "contracts/fixtures/tree.json"), {
      name: "root",
      children: [{ name: "child", children: [{ label: "renamed" }] }],
    });
    expect(run(CONTRACT_CLI, root).status).toBe(1);
  });

  it("accepts a valid fixture and rejects contract drift that violates the schema", () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "contracts/fixtures"), { recursive: true });
    writeJson(join(root, "contracts/gateway-schemas.json"), {
      $defs: {
        Menu: {
          type: "array",
          items: {
            type: "object",
            required: ["label", "href"],
            properties: { label: { type: "string" }, href: { type: "string" } },
            additionalProperties: true,
          },
        },
      },
    });
    writeJson(join(root, "contracts/gateway-contracts.json"), {
      schema: "gateway-schemas.json",
      contracts: [
        {
          id: "menu",
          path: "/menu",
          fixture: "fixtures/menu.json",
          schema: "#/$defs/Menu",
        },
      ],
    });

    const missing = run(CONTRACT_CLI, root);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("Fixture not found: contracts/fixtures/menu.json");
    expect(missing.stderr).not.toContain("ENOENT");

    writeJson(join(root, "contracts/fixtures/menu.json"), [{ label: "Home", href: "/" }]);

    expect(run(CONTRACT_CLI, root).status).toBe(0);

    writeJson(join(root, "contracts/fixtures/menu.json"), [{ label: "Home" }]);
    const invalid = run(CONTRACT_CLI, root);
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toContain("must have required property 'href'");
  });

  it("supports manifest v2 auth profiles while keeping local fixture checks secret-free", async () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "contracts/fixtures"), { recursive: true });
    writeJson(join(root, "contracts/gateway-schemas.json"), {
      $defs: {
        Profile: {
          type: "object",
          required: ["displayName"],
          properties: { displayName: { type: "string" } },
          additionalProperties: true,
        },
      },
    });
    writeJson(join(root, "contracts/fixtures/profile.json"), { displayName: "Ada" });
    const manifest = {
      schemaVersion: 2,
      schema: "gateway-schemas.json",
      authProfiles: {
        "staging-user": { type: "bearer", tokenEnv: "CONTRACT_USER_BEARER_TOKEN" },
      },
      contracts: [
        {
          id: "profile-success",
          operationId: "auth.profile",
          request: { method: "GET", path: "/user/profile", auth: "staging-user" },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/profile.json",
            schema: "#/$defs/Profile",
          },
        },
      ],
    };
    writeJson(join(root, "contracts/gateway-contracts.json"), manifest);

    const local = run(CONTRACT_CLI, root);
    expect(local.status).toBe(0);
    expect(local.stdout).toContain("manifest v2");

    const gateway = await startFakeGateway([
      { path: "/user/profile", body: { displayName: "Ada" } },
    ]);
    try {
      const result = await execFileAsync(
        process.execPath,
        [CONTRACT_CLI, "--base-url", gateway.baseUrl],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, CONTRACT_USER_BEARER_TOKEN: "test-secret" },
        },
      );
      expect(result.stdout).toContain("profile-success");
      expect(result.stdout).not.toContain("test-secret");
      expect(gateway.requests[0].headers.authorization).toBe("Bearer test-secret");
    } finally {
      await gateway.close();
    }

    manifest.contracts[0].request.auth = "missing-profile";
    writeJson(join(root, "contracts/gateway-contracts.json"), manifest);
    const invalid = run(CONTRACT_CLI, root);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("references unknown auth profile: missing-profile");
  });

  it("sends bound POST bodies and headers, accepts negative status cases and validates empty responses", async () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "contracts/fixtures/requests"), { recursive: true });
    writeJson(join(root, "contracts/gateway-schemas.json"), {
      $defs: {
        RefreshRequest: {
          type: "object",
          required: ["refreshToken"],
          properties: { refreshToken: { type: "string", minLength: 8 } },
          additionalProperties: false,
        },
        TokenResponse: {
          type: "object",
          required: ["accessToken", "refreshToken"],
          properties: { accessToken: { type: "string" }, refreshToken: { type: "string" } },
          additionalProperties: false,
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" } },
          additionalProperties: false,
        },
        AnalyticsEvent: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } },
          additionalProperties: false,
        },
      },
    });
    writeJson(join(root, "contracts/fixtures/requests/refresh.json"), {
      refreshToken: "fixture-token",
    });
    writeJson(join(root, "contracts/fixtures/refresh-response.json"), {
      accessToken: "access",
      refreshToken: "rotated",
    });
    writeJson(join(root, "contracts/fixtures/unauthorized.json"), { error: "unauthorized" });
    writeJson(join(root, "contracts/fixtures/requests/analytics.json"), { path: "/catalog" });
    const manifest = {
      schemaVersion: 2,
      schema: "gateway-schemas.json",
      authProfiles: {
        "staging-user": { type: "bearer", tokenEnv: "CONTRACT_USER_BEARER_TOKEN" },
      },
      contracts: [
        {
          id: "refresh-success",
          operationId: "auth.refresh",
          request: {
            method: "POST",
            path: "/auth/refresh",
            auth: "staging-user",
            headers: {
              "x-contract-client": { value: "originloom" },
              "x-api-key": { env: "CONTRACT_API_KEY" },
            },
            body: {
              fixture: "fixtures/requests/refresh.json",
              schema: "#/$defs/RefreshRequest",
              contentType: "application/json",
              envBindings: { "/refreshToken": "CONTRACT_REFRESH_TOKEN" },
            },
          },
          response: {
            status: 200,
            contentType: "application/json",
            fixture: "fixtures/refresh-response.json",
            schema: "#/$defs/TokenResponse",
          },
        },
        {
          id: "profile-unauthorized",
          operationId: "auth.profile",
          request: { method: "GET", path: "/user/profile" },
          response: {
            status: 401,
            contentType: "application/json",
            fixture: "fixtures/unauthorized.json",
            schema: "#/$defs/ErrorResponse",
          },
        },
        {
          id: "analytics-accepted",
          operationId: "analytics.bot",
          request: {
            method: "POST",
            path: "/analytics/bot",
            body: {
              fixture: "fixtures/requests/analytics.json",
              schema: "#/$defs/AnalyticsEvent",
            },
          },
          response: { status: 202 },
        },
      ],
    };
    writeJson(join(root, "contracts/gateway-contracts.json"), manifest);

    expect(run(CONTRACT_CLI, root).status).toBe(0);

    const routes = [
      {
        method: "POST",
        path: "/auth/refresh",
        body: { accessToken: "access", refreshToken: "rotated" },
      },
      { path: "/user/profile", status: 401, body: { error: "unauthorized" } },
      { method: "POST", path: "/analytics/bot", status: 202 },
    ];
    const gateway = await startFakeGateway(routes);
    const env = {
      ...process.env,
      CONTRACT_USER_BEARER_TOKEN: "bearer-secret",
      CONTRACT_API_KEY: "api-secret",
      CONTRACT_REFRESH_TOKEN: "refresh-secret",
    };
    try {
      const result = await execFileAsync(
        process.execPath,
        [CONTRACT_CLI, "--base-url", gateway.baseUrl],
        { cwd: root, encoding: "utf8", env },
      );
      expect(result.stdout).toContain("refresh-success");
      expect(result.stdout).toContain("profile-unauthorized");
      expect(result.stdout).toContain("analytics-accepted");
      for (const secret of ["bearer-secret", "api-secret", "refresh-secret"]) {
        expect(result.stdout).not.toContain(secret);
        expect(result.stderr).not.toContain(secret);
      }
      expect(gateway.requests[0]).toMatchObject({
        method: "POST",
        headers: {
          authorization: "Bearer bearer-secret",
          "content-type": "application/json",
          "x-api-key": "api-secret",
          "x-contract-client": "originloom",
        },
        json: { refreshToken: "refresh-secret" },
      });
      expect(gateway.requests[2].json).toEqual({ path: "/catalog" });

      manifest.contracts[1].response.status = 200;
      writeJson(join(root, "contracts/gateway-contracts.json"), manifest);
      await expect(
        execFileAsync(process.execPath, [CONTRACT_CLI, "--base-url", gateway.baseUrl], {
          cwd: root,
          encoding: "utf8",
          env,
        }),
      ).rejects.toMatchObject({ stdout: expect.stringContaining("HTTP 401") });

      manifest.contracts[1].response.status = 401;
      manifest.contracts[0].response.contentType = "application/xml";
      writeJson(join(root, "contracts/gateway-contracts.json"), manifest);
      await expect(
        execFileAsync(process.execPath, [CONTRACT_CLI, "--base-url", gateway.baseUrl], {
          cwd: root,
          encoding: "utf8",
          env,
        }),
      ).rejects.toMatchObject({
        stdout: expect.stringContaining("Content-Type application/json, expected application/xml"),
      });

      manifest.contracts[0].response.contentType = "application/json";
      routes[2].body = { accepted: true };
      writeJson(join(root, "contracts/gateway-contracts.json"), manifest);
      await expect(
        execFileAsync(process.execPath, [CONTRACT_CLI, "--base-url", gateway.baseUrl], {
          cwd: root,
          encoding: "utf8",
          env,
        }),
      ).rejects.toMatchObject({
        stdout: expect.stringContaining("Expected an empty response body"),
      });
    } finally {
      await gateway.close();
    }
  });

  it("rejects unsafe manifest v2 request definitions before issuing requests", () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "contracts/fixtures"), { recursive: true });
    writeJson(join(root, "contracts/gateway-schemas.json"), {
      $defs: { Empty: { type: "object" } },
    });
    writeJson(join(root, "contracts/fixtures/empty.json"), {});
    const manifest = {
      schemaVersion: 2,
      schema: "gateway-schemas.json",
      contracts: [
        {
          id: "unsafe-request",
          operationId: "unsafe.request",
          request: {
            method: "GET",
            path: "/unsafe",
            headers: { Authorization: { value: "secret" } },
          },
          response: {
            status: 200,
            fixture: "fixtures/empty.json",
            schema: "#/$defs/Empty",
          },
        },
      ],
    };
    writeJson(join(root, "contracts/gateway-contracts.json"), manifest);

    const manualAuth = run(CONTRACT_CLI, root);
    expect(manualAuth.status).toBe(1);
    expect(manualAuth.stderr).toContain("must use an auth profile");
    expect(manualAuth.stderr).not.toContain("secret");

    delete manifest.contracts[0].request.headers;
    manifest.contracts[0].request.body = {
      fixture: "fixtures/empty.json",
      schema: "#/$defs/Empty",
    };
    writeJson(join(root, "contracts/gateway-contracts.json"), manifest);
    const getBody = run(CONTRACT_CLI, root);
    expect(getBody.status).toBe(1);
    expect(getBody.stderr).toContain("cannot define a body for GET");
  });

  it("fails when a required chunk is absent or exceeds its gzip budget", () => {
    const root = temporaryRoot();
    mkdirSync(join(root, "dist/client/assets"), { recursive: true });
    writeJson(join(root, "performance-budgets.json"), {
      assetRoot: "dist/client/assets",
      assets: [{ name: "entry", pattern: "^entry-.*\\.js$", maxGzipBytes: 100 }],
    });

    expect(run(BUDGET_CLI, root).status).toBe(1);

    writeFileSync(join(root, "dist/client/assets/entry-test.js"), randomText(1_000));
    const oversized = run(BUDGET_CLI, root);
    expect(oversized.status).toBe(1);
    expect(oversized.stdout).toContain("over budget");

    writeJson(join(root, "performance-budgets.json"), {
      assetRoot: "dist/client/assets",
      assets: [{ name: "entry", pattern: "^entry-.*\\.js$", maxGzipBytes: 2_000 }],
    });
    expect(run(BUDGET_CLI, root).status).toBe(0);
  });
});

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "origin-quality-gates-"));
  roots.push(root);
  return root;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(cli, cwd) {
  return spawnSync(process.execPath, [cli], { cwd, encoding: "utf8" });
}

function randomText(length) {
  let seed = 17;
  return Array.from({ length }, () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return String.fromCharCode(33 + (seed % 90));
  }).join("");
}
