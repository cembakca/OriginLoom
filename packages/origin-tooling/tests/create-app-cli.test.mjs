import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../bin/create-app.mjs", import.meta.url));
const scratchDirs = [];

/** A fresh temp dir with no pnpm-workspace.yaml above it, so the CLI treats it as standalone. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "origin-create-app-"));
  scratchDirs.push(dir);
  return dir;
}

/** Run the generator. `cwd` defaults to a scratch dir so we never touch this repo. */
function run(args, { cwd = scratch(), input = "" } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: "utf8",
  });
  return { ...res, cwd };
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("origin-create-app CLI — standalone", () => {
  it("scaffolds into --target-dir and reports standalone", () => {
    const target = scratch();
    const { status, stdout } = run([
      "investment-web",
      "--title",
      "Yatırım",
      "--target-dir",
      target,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("standalone: true");
    const pkg = JSON.parse(readFileSync(join(target, "investment-web/package.json"), "utf8"));
    expect(pkg.name).toBe("investment-web");
    expect(pkg.dependencies["@originloom/core"]).toBe("^0.1.0");
  });

  it("passes --version through to the pinned dependency range", () => {
    const target = scratch();
    const { status } = run([
      "demo",
      "--title",
      "Demo",
      "--version",
      "^2.3.4",
      "--target-dir",
      target,
    ]);
    expect(status).toBe(0);
    const pkg = JSON.parse(readFileSync(join(target, "demo/package.json"), "utf8"));
    expect(pkg.dependencies["@originloom/react"]).toBe("^2.3.4");
  });

  it("prompts for name and title over piped stdin when flags are omitted", () => {
    const target = scratch();
    // Non-TTY stdin: the prompter consumes piped lines in order.
    const { status } = run(["--target-dir", target], { input: "piped-web\nPiped Title\n" });
    expect(status).toBe(0);
    expect(existsSync(join(target, "piped-web/package.json"))).toBe(true);
    expect(readFileSync(join(target, "piped-web/README.md"), "utf8")).toContain("Piped Title");
  });
});

describe("origin-create-app CLI — workspace", () => {
  it("scaffolds under apps/<name> with workspace:* deps inside a workspace", () => {
    const ws = scratch();
    writeFileSync(join(ws, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    const { status, stdout } = run(["ws-web", "--title", "WS", "--workspace"], { cwd: ws });
    expect(status).toBe(0);
    expect(stdout).toContain("pnpm --filter ws-web dev");
    const pkg = JSON.parse(readFileSync(join(ws, "apps/ws-web/package.json"), "utf8"));
    expect(pkg.dependencies["@originloom/core"]).toBe("workspace:*");
  });

  it("refuses --workspace when no workspace root is found", () => {
    const { status, stderr } = run(["ws-web", "--title", "WS", "--workspace"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/workspace/i);
  });
});

describe("origin-create-app CLI — validation", () => {
  const cases = [
    {
      label: "invalid kebab-case name",
      args: ["Bad_Name", "--title", "X"],
      match: /invalid project name/i,
    },
    { label: "reserved name showroom", args: ["showroom", "--title", "X"], match: /showroom/i },
    {
      label: "privileged port",
      args: ["ok", "--title", "X", "--port", "80"],
      match: /invalid --port/i,
    },
    {
      label: "unknown option",
      args: ["ok", "--title", "X", "--frobnicate"],
      match: /unknown option/i,
    },
  ];

  for (const { label, args, match } of cases) {
    it(`exits non-zero on ${label}`, () => {
      const { status, stderr } = run(args);
      expect(status).not.toBe(0);
      expect(stderr).toMatch(match);
    });
  }

  it("refuses to overwrite an existing target directory", () => {
    const target = scratch();
    expect(run(["dup", "--title", "X", "--target-dir", target]).status).toBe(0);
    const { status, stderr } = run(["dup", "--title", "X", "--target-dir", target]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/already exists/i);
  });
});

describe("origin-create-app CLI — renderer selection", () => {
  it("scaffolds a vanilla app with --vanilla", () => {
    const target = scratch();
    const { status } = run([
      "landing-web",
      "--title",
      "Landing",
      "--vanilla",
      "--target-dir",
      target,
    ]);
    expect(status).toBe(0);

    const appDir = join(target, "landing-web");
    const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
    expect(pkg.dependencies["@originloom/vanilla"]).toBe("^0.1.0");
    expect(pkg.dependencies.react).toBeUndefined();
    expect(existsSync(join(appDir, "src/pages/home.ts"))).toBe(true);
    expect(existsSync(join(appDir, "src/islands/counter.ts"))).toBe(true);
    expect(existsSync(join(appDir, "server/routes/home.tsx"))).toBe(false);
  });

  it("accepts the explicit --renderer form and rejects anything else", () => {
    const target = scratch();
    expect(
      run(["a-web", "--title", "A", "--renderer", "react", "--target-dir", target]).status,
    ).toBe(0);
    expect(existsSync(join(target, "a-web/server/routes/home.tsx"))).toBe(true);

    const bad = run(["b-web", "--title", "B", "--renderer", "svelte", "--target-dir", scratch()]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("Invalid --renderer");
  });
});

describe("origin-create-app CLI — standalone inside a workspace", () => {
  /** A scratch dir that looks like an OriginLoom workspace to findWorkspaceRoot. */
  function workspaceScratch() {
    const dir = scratch();
    writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    return dir;
  }

  it("warns that the generated app cannot install its platform packages", () => {
    const cwd = workspaceScratch();
    const { status, stderr } = run(["landing-web", "--title", "Landing"], { cwd });

    expect(status).toBe(0);
    expect(stderr).toContain("standalone app inside an OriginLoom workspace");
    expect(stderr).toContain("--workspace");
  });

  it("stays quiet for a standalone app generated outside a workspace", () => {
    const { status, stderr } = run(["landing-web", "--title", "Landing"]);
    expect(status).toBe(0);
    expect(stderr).not.toContain("standalone app inside an OriginLoom workspace");
  });

  it("stays quiet when the app is written outside the workspace it was run from", () => {
    const cwd = workspaceScratch();
    const target = scratch();
    const { status, stderr } = run(["landing-web", "--title", "Landing", "--target-dir", target], {
      cwd,
    });

    expect(status).toBe(0);
    expect(stderr).not.toContain("standalone app inside an OriginLoom workspace");
  });
});
