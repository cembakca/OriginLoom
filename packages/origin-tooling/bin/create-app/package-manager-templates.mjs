import {
  installCommand,
  lockfileFor,
  NPM_VERSION,
  packageManagerPin,
  PNPM_VERSION,
  runScriptCommand,
  YARN_VERSION,
} from "../lib/package-manager.mjs";

/** @typedef {import("../lib/package-manager.mjs").PackageManager} PackageManager */

/** @param {PackageManager} pm */
export function workflowSetupSteps(pm) {
  switch (pm) {
    case "pnpm":
      return `      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: pnpm`;
    case "npm":
      return `      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: npm`;
    case "yarn":
      return `      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: yarn

      - name: Enable Corepack
        run: corepack enable`;
  }
}

/** @param {PackageManager} pm */
export function workflowInstallStep(pm) {
  return `      - name: Install dependencies
        run: ${installCommand(pm)}`;
}

/** @param {string} name @param {PackageManager} pm */
export function githubWorkflow(name, pm) {
  const playwrightInstall = runScriptCommand(pm, "e2e:install");
  const verify = runScriptCommand(pm, "ci");
  return `name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

${workflowSetupSteps(pm)}

      # @originloom/* comes from a private registry. The local .npmrc points at a
      # developer's machine, which CI cannot reach — point it at the real one and
      # give it a token if the registry requires auth.
      #   NPM_CONFIG_REGISTRY: \${{ vars.NPM_REGISTRY_URL }}
      #   NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
${workflowInstallStep(pm)}

      - name: Install Chromium
        run: ${playwrightInstall}

      # typecheck, cycles, lint, format, tests, browser E2E, build and a smoke run.
      # Playwright and smoke each manage the mock gateway process they need.
      - name: Verify
        run: ${verify}

      - name: Upload Playwright report
        if: always() && hashFiles('playwright-report/**') != ''
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14

      - name: Upload Lighthouse reports
        if: always() && hashFiles('.lighthouseci/reports/**') != ''
        uses: actions/upload-artifact@v7
        with:
          name: lighthouse-reports
          path: .lighthouseci/reports/
          retention-days: 14

      - name: Build container
        run: docker build --tag ${name}:\${{ github.sha }} .
`;
}

/** @param {PackageManager} pm */
export function dependencyTrackWorkflow(pm) {
  const sbom = runScriptCommand(pm, "sbom");
  const publish = runScriptCommand(pm, "dependency-track:publish");
  return `name: Dependency inventory

on:
  pull_request:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: dependency-track-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  sbom:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      DEPENDENCY_TRACK_URL: \${{ vars.DEPENDENCY_TRACK_URL }}

    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

${workflowSetupSteps(pm)}
${workflowInstallStep(pm)}

      - name: Generate CycloneDX SBOM
        run: ${sbom}

      - name: Upload SBOM artifact
        uses: actions/upload-artifact@v7
        with:
          name: cyclonedx-sbom-\${{ github.sha }}
          path: artifacts/sbom/bom.cdx.json
          if-no-files-found: error
          retention-days: 30

      # Pull requests never receive the API key. Push/tag runs publish only after
      # DEPENDENCY_TRACK_URL is configured as a repository variable.
      - name: Publish and enforce Dependency-Track gate
        if: github.event_name != 'pull_request' && env.DEPENDENCY_TRACK_URL != ''
        env:
          DEPENDENCY_TRACK_API_KEY: \${{ secrets.DEPENDENCY_TRACK_API_KEY }}
        run: ${publish}
`;
}

/** @param {string} name @param {number} port @param {PackageManager} pm */
export function standaloneDockerfile(name, port, pm) {
  const lockfile = lockfileFor(pm);
  switch (pm) {
    case "pnpm":
      return `# Build context is this app's root:
#   docker build -t ${name} .
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json ${lockfile}* ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm typecheck && pnpm build

${dockerfileRunner(name, port, "/app/dist")}`;
    case "npm":
      return `# Build context is this app's root:
#   docker build -t ${name} .
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ${lockfile} ./
RUN npm ci

COPY . .
RUN npm run typecheck && npm run build

${dockerfileRunner(name, port, "/app/dist")}`;
    case "yarn":
      return `# Build context is this app's root:
#   docker build -t ${name} .
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /app

COPY package.json ${lockfile} .yarnrc.yml ./
RUN yarn install --immutable

COPY . .
RUN yarn run typecheck && yarn run build

${dockerfileRunner(name, port, "/app/dist")}`;
  }
}

/** @param {string} name @param {number} port @param {string} distPath */
export function dockerfileRunner(name, port, distPath) {
  return `FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=${port}

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# The bundled package managers are the image's entire JavaScript dependency
# surface — this container only ever runs \`node\` against a self-contained
# bundle, so they are removed rather than carried along with their CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \\
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# The server bundle is self-contained (ssr.noExternal: true) — no node_modules needed.
COPY --from=builder --chown=nodejs:nodejs ${distPath} ./dist
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
RUN printf '{"type":"module"}\\n' > package.json

USER nodejs

EXPOSE ${port}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||${port})+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server/index.js"]
`;
}

/** @param {PackageManager} pm */
export function packageManagerRequirements(pm) {
  switch (pm) {
    case "pnpm":
      return `- Corepack üzerinden pnpm ${PNPM_VERSION}`;
    case "npm":
      return `- npm ${NPM_VERSION} (Node.js ile birlikte veya Corepack)`;
    case "yarn":
      return `- Corepack üzerinden Yarn Berry ${YARN_VERSION}`;
  }
}

/** @param {PackageManager} pm @param {boolean} standalone @param {string} name */
export function readmeInstallBlock(pm, standalone, name) {
  const install = installCommand(pm, { frozen: false });
  const e2eInstall = runScriptCommand(pm, "e2e:install");
  const ci = runScriptCommand(pm, "ci");
  const devMock = runScriptCommand(pm, "dev:mock");
  const dev = runScriptCommand(pm, "dev");
  const lockfile = lockfileFor(pm);

  if (!standalone) {
    const filterPrefix = pm === "pnpm" ? `pnpm --filter ${name} ` : pm === "npm" ? "npm run " : "yarn run ";
    return `Bu uygulama OriginLoom monorepo içindeki \`apps/${name}\` workspace'idir. Komutları repository
kökünden çalıştırın:

\`\`\`bash
corepack enable
${install}
${filterPrefix}e2e:install
${filterPrefix}ci
${filterPrefix}dev
\`\`\``;
  }

  return `Bu uygulama ayrı bir repository olarak üretildi. \`--registry\` kullanıldıysa kökteki
\`.npmrc\` yalnız \`@originloom/*\` paketlerini ilgili registry'ye yönlendirir; authentication
bilgilerini repository'ye yazmayın.

\`\`\`bash
corepack enable
${install}
${e2eInstall}

# Commit/PR açmadan önce tüm kalite kapısını doğrulayın.
${ci}

# Uygulama + Vite + paketli mock gateway. İlk çalıştırma için bu.
${devMock}

# Kendi gateway'iniz varsa (GATEWAY_URL) yalnız uygulama + Vite:
${dev}
\`\`\`

İlk kurulumdan sonra \`${lockfile}\` dosyasını repository'ye ekleyin. Gerçek gateway'e geçmeden
önce mock verilerle çalışan route'ları kontrol edin.`;
}

/** @param {PackageManager} pm */
export function readmeCommandTable(pm) {
  const run = (script) => runScriptCommand(pm, script);
  return `| Komut                 | Açıklama                                                     |
| --------------------- | ------------------------------------------------------------ |
| \`${run("dev")}\`            | Yalnız SSR + Vite; gateway sizin (GATEWAY_URL)               |
| \`${run("dev:mock")}\`       | SSR + Vite + paketli mock gateway                            |
| \`${run("mock-gw")}\`        | Yalnız mock gateway (ayrı terminalde)                        |
| \`${run("origin:doctor")}\`  | Platform/template uyumluluğunu read-only denetler             |
| \`${run("origin:migrate")}\` | Upgrade planını dry-run gösterir; \`--apply\` ile uygular       |
| \`${run("sbom")}\`           | CycloneDX 1.6 full dependency envanteri üretir                  |
| \`${run("sbom:prod")}\`      | Yalnız production dependency envanterini üretir                 |
| \`${run("dependency-track:publish")}\` | SBOM'u yükler, analizi bekler ve güvenlik kapısını çalıştırır |
| \`${run("typecheck")}\`      | TypeScript kontrolü                                          |
| \`${run("check:cycles")}\`   | Import cycle ve katman sınırlarını kontrol eder              |
| \`${run("test")}\`           | Unit/integration testlerini çalıştırır                       |
| \`${run("build")}\`          | Bundle, gerçek route/cache özeti ve \`dist/originloom-manifest.json\` üretir |
| \`${run("contracts:fixtures")}\` | Fixture'ları OpenAPI consumer contract'ına karşı doğrular |
| \`${run("contracts:scaffold")}\` | Ham gateway cevabından contract + service iskeleti üretir |
| \`${run("budget:bundle")}\`  | Island/client gzip bütçelerini kontrol eder                   |
| \`${run("lighthouse")}\`     | Route performance ve accessibility bütçelerini çalıştırır    |
| \`${run("capacity")}\`       | Tüm route'larda kademeli kapasite testi ve Markdown/JSON raporu üretir |
| \`${run("capacity:quick")}\` | Kapasite runner'ının kısa doğrulama profilini çalıştırır      |
| \`${run("capacity:profile")}\` | Seçilen route için ayrı CPU/heap profiling raporu üretir    |
| \`${run("performance:compare")}\` | Son kapasite raporunu kabul edilmiş baseline ile karşılaştırır |
| \`${run("performance:accept")}\` | İncelenen son full raporu yeni baseline olarak kaydeder       |
| \`${run("smoke")}\`          | Built server'ı mock gateway ile probe eder                   |
| \`${run("ci")}\`             | Typecheck, cycle, lint, format, test, build ve smoke çalıştırır |
| \`${run("media")}\`          | Responsive image/font manifestini üretir                     |
| \`${run("icons")}\`          | SVG kaynaklarından typed React icon'ları üretir              |`;
}

/** @param {PackageManager} pm */
export function yarnrcYaml() {
  return `nodeLinker: node-modules
`;
}

/** @param {PackageManager} pm */
export function packageManagerFieldValue(pm) {
  return packageManagerPin(pm);
}
