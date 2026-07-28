# Build context: repository root (docker build -f apps/showroom/Dockerfile .)
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter showroom typecheck && pnpm --filter showroom build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3005

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# The bundled package managers are the image's entire JavaScript dependency
# surface — this container only ever runs `node` against a self-contained
# bundle, so they are removed rather than carried along with their CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# The server bundle is fully self-contained (ssr.noExternal: true) — no node_modules needed.
COPY --from=builder --chown=nodejs:nodejs /repo/apps/showroom/dist ./dist
RUN printf '{"type":"module"}\n' > package.json

USER nodejs

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3005)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server/index.js"]
