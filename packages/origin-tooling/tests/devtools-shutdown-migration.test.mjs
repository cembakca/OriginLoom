import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import { format, resolveConfig } from "prettier";
import { afterEach, describe, expect, it } from "vitest";

import { renderTemplates } from "../bin/create-app/templates.mjs";
import {
  DEVTOOLS_OPTION_MIGRATION,
  migrations,
  SHUTDOWN_DRAIN_ORDER_MIGRATION,
} from "../bin/upgrade/migrations.mjs";

const scratch = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const devtools = migrations.find(({ id }) => id === DEVTOOLS_OPTION_MIGRATION);
const shutdown = migrations.find(({ id }) => id === SHUTDOWN_DRAIN_ORDER_MIGRATION);

function projectWith(files) {
  const root = mkdtempSync(join(tmpdir(), "originloom-0-7-32-"));
  scratch.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(migration, root) {
  const changes = [];
  const fileWrites = {};
  const manualRequired = [];
  migration.migrateProject(root, changes, fileWrites, manualRequired);
  return { changes, fileWrites, manualRequired };
}

/** A migration that leaves the app failing its own `prettier --check` is a broken migration. */
async function expectPrettier(path, source) {
  const config = await resolveConfig(path);
  expect(await format(source, { ...config, filepath: path })).toBe(source);
}

/** The 0.7.31 client entry: reload buttons and telemetry, no devtools anywhere. */
const ENTRY_0_7_31 = `import "./styles/globals.css";

import {
  logPageRequestIdInDev,
  reportClientError,
} from "@originloom/shared/lib/client/error-telemetry";
import { runIslandBootstrap } from "@originloom/shared/lib/client/island-runtime";
import { installReloadButtons } from "@originloom/shared/lib/client/reload-button";

installReloadButtons();
logPageRequestIdInDev();

runIslandBootstrap(
  (element) => {
    import("./hydrate.client")
      .then(({ mount }) => void mount(element))
      .catch((error) => reportClientError("island-bootstrap", error));
  },
  { onObserverError: (error) => reportClientError("island-bootstrap", error) },
);
`;

/** An app that adopted the panel by hand before it became an option. */
const ENTRY_WITH_UNCONDITIONAL_PANEL = ENTRY_0_7_31.replace(
  "logPageRequestIdInDev();\n",
  `logPageRequestIdInDev();

if (import.meta.env.DEV) {
  void import("@originloom/shared/lib/client/devtools").then(({ mountDevtoolsPanel }) =>
    mountDevtoolsPanel(),
  );
}
`,
);

const SHUTDOWN_0_7_31 = `async function main() {
  const shutdown = () => {
    void (async () => {
      try {
        await Promise.all([
          closeServer(httpServer),
          closeServer(metricsServer),
          drainRevalidations(config.revalidationDrainTimeoutMs),
          drainAfter(),
          drainBotAnalytics(),
        ]);
        await closeCache();
      } catch (error) {
        logError(error);
      }
    })();
  };
}
`;

describe("0.7.32 devtools client option migration", () => {
  it("gives a pre-devtools entry the option, the import and the guarded mount", async () => {
    const { changes, fileWrites, manualRequired } = run(
      devtools,
      projectWith({ "src/entry.client.tsx": ENTRY_0_7_31 }),
    );
    const patched = fileWrites["src/entry.client.tsx"];

    expect(manualRequired).toEqual([]);
    expect(changes.map(({ kind }) => kind)).toEqual(["patch"]);
    expect(patched).toContain(
      'import type { OriginLoomClientOptions } from "@originloom/shared/lib/client/options";',
    );
    expect(patched).toContain("const originLoomOptions: OriginLoomClientOptions = {");
    expect(patched).toContain("if (import.meta.env.DEV && devtoolsEnabled) {");
    expect(patched).toContain("mountDevtoolsPanel({ enabled: devtoolsEnabled })");
    await expectPrettier("src/entry.client.tsx", patched);
  });

  // The flag has to reach the guard as well as the call: a panel that still
  // mounts on `import.meta.env.DEV` alone ignores an app that turned it off.
  it("threads the flag through an entry that already mounts the panel", async () => {
    const { fileWrites } = run(
      devtools,
      projectWith({ "src/entry.client.tsx": ENTRY_WITH_UNCONDITIONAL_PANEL }),
    );
    const patched = fileWrites["src/entry.client.tsx"];

    expect(patched).toContain("if (import.meta.env.DEV && devtoolsEnabled) {");
    expect(patched).toContain("mountDevtoolsPanel({ enabled: devtoolsEnabled })");
    expect(patched).not.toContain("mountDevtoolsPanel(),");
    // One panel, not two: the existing block is upgraded, never duplicated.
    expect(patched.match(/lib\/client\/devtools/g)).toHaveLength(1);
    await expectPrettier("src/entry.client.tsx", patched);
  });

  it("is a no-op on the entry the current template already generates", () => {
    const entry = renderTemplates({
      name: "t",
      title: "T",
      port: 3010,
      metricsPort: 9010,
      mode: "standalone",
      version: "^0.7.32",
    })["src/entry.client.tsx"];

    const { changes, fileWrites } = run(devtools, projectWith({ "src/entry.client.tsx": entry }));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });

  it("is idempotent", () => {
    const root = projectWith({ "src/entry.client.tsx": ENTRY_0_7_31 });
    writeFileSync(
      join(root, "src/entry.client.tsx"),
      run(devtools, root).fileWrites["src/entry.client.tsx"],
    );

    expect(run(devtools, root).fileWrites).toEqual({});
  });

  // A hand-written entry is the app's; guessing at it is worse than asking.
  it("asks for a manual edit when the entry is not the generated one", () => {
    const { changes, fileWrites, manualRequired } = run(
      devtools,
      projectWith({ "src/entry.client.tsx": "export {};\n" }),
    );

    expect(fileWrites).toEqual({});
    expect(changes.map(({ kind }) => kind)).toEqual(["manual-required"]);
    expect(manualRequired[0].detail).toContain("OriginLoomClientOptions");
  });

  it("leaves a project without a client entry alone", () => {
    const { changes, fileWrites } = run(devtools, projectWith({}));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });
});

describe("0.7.32 shutdown drain order migration", () => {
  it("closes the listeners in their own phase, before the drains", async () => {
    const { changes, fileWrites, manualRequired } = run(
      shutdown,
      projectWith({ "server/index.ts": SHUTDOWN_0_7_31 }),
    );
    const patched = fileWrites["server/index.ts"];

    expect(manualRequired).toEqual([]);
    expect(changes.map(({ kind }) => kind)).toEqual(["patch"]);
    expect(patched).toContain(
      "await Promise.all([closeServer(httpServer), closeServer(metricsServer)]);",
    );
    expect(patched.indexOf("closeServer(metricsServer)")).toBeLessThan(
      patched.indexOf("drainRevalidations"),
    );
    await expectPrettier("server/index.ts", patched);
  });

  // Splitting the phases must not quietly drop a drain from the shutdown budget.
  it("keeps every drain, in order", () => {
    const { fileWrites } = run(shutdown, projectWith({ "server/index.ts": SHUTDOWN_0_7_31 }));
    const drains = [...fileWrites["server/index.ts"].matchAll(/\bdrain[A-Za-z]*\(/g)].map(
      ([match]) => match,
    );

    expect(drains).toEqual(["drainRevalidations(", "drainAfter(", "drainBotAnalytics("]);
  });

  it("is idempotent", () => {
    const root = projectWith({ "server/index.ts": SHUTDOWN_0_7_31 });
    writeFileSync(join(root, "server/index.ts"), run(shutdown, root).fileWrites["server/index.ts"]);

    const second = run(shutdown, root);
    expect(second.changes).toEqual([]);
    expect(second.fileWrites).toEqual({});
  });

  it("is a no-op on the server the current template already generates", () => {
    const server = renderTemplates({
      name: "t",
      title: "T",
      port: 3010,
      metricsPort: 9010,
      mode: "standalone",
      version: "^0.7.32",
    })["server/index.ts"];

    const { changes, fileWrites } = run(shutdown, projectWith({ "server/index.ts": server }));
    expect(changes).toEqual([]);
    expect(fileWrites).toEqual({});
  });

  it("asks for a manual edit when the shutdown is not the generated one", () => {
    const { changes, fileWrites, manualRequired } = run(
      shutdown,
      projectWith({ "server/index.ts": "process.on('SIGTERM', () => process.exit(0));\n" }),
    );

    expect(fileWrites).toEqual({});
    expect(changes.map(({ kind }) => kind)).toEqual(["manual-required"]);
    expect(manualRequired[0].detail).toContain("closeServer");
  });
});
