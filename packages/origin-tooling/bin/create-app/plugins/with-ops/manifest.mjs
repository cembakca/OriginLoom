import { renderOpsTemplates } from "./files.mjs";

/** @type {import("../registry.mjs").CreateAppPlugin} */
export const withOpsPlugin = {
  id: "with-ops",
  flags: ["--with-ops"],
  files(ctx) {
    return renderOpsTemplates({
      name: ctx.name,
      port: ctx.port,
      metricsPort: ctx.metricsPort,
      includeCapacity: true,
    });
  },
  packageJsonPatches: {
    scripts: {
      "compose:up": "origin-compose-up",
      "compose:redis": "origin-compose-up --redis",
      "compose:clean": "origin-docker-clean",
      "dev:redis": "origin-dev-local",
      "start:local:redis": "origin-run-local production --redis",
      loadtest: "node load-test/run.mjs",
      stress: "node load-test/stress.mjs",
      "loadtest:compare": "node load-test/compare.mjs",
      "pentest:readiness": "node scripts/pentest-readiness.mjs",
    },
  },
  textPatches: {
    "README.md": [
      {
        type: "replaceBlock",
        anchor: "<!-- @originloom:hook readme-ops-table -->",
        replacement: `| \`pnpm compose:up\`     | Generated Compose stack'ini başlatır                         |
| \`pnpm loadtest\`       | Load profilini çalıştırıp JSON sonuç üretir                   |
| \`pnpm stress\`         | Stress senaryosunu çalıştırır                                |
| \`pnpm loadtest:compare\` | İki load sonucunu regression açısından karşılaştırır       |
| \`pnpm pentest:readiness\` | Uygulamayı pentest öncesi güvenlik kontrollerinden geçirir |`,
      },
    ],
  },
};
