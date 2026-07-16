FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./

ENV PORT=4002
EXPOSE 4002

HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4002/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
