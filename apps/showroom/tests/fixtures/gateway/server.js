import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { menu } from "./data/menu.js";
import { bankProfiles, creditCards, housingLoans } from "./data/financial-products.js";
import { knowledgeArticles } from "./data/knowledge-center.js";
import { resolveFinanceRequest } from "./routes/finance.js";
import { resolveKnowledgeCenterRequest } from "./routes/knowledge-center.js";
import { resolveMarketStreamRequest } from "./routes/market-stream.js";
import { resolveMarketsRequest } from "./routes/markets.js";

// Keep the mock gateway independent from the SSR app's PORT. The shared smoke
// runner assigns a collision-free gateway port through this dedicated value.
const port = Number(process.env.MOCK_GATEWAY_PORT ?? 4002);
const host = process.env.HOST ?? "0.0.0.0";
const quiet = process.env.MOCK_GW_QUIET === "1";

const routeDomains = {
  recoursePages: ["kredi"],
};

const sitemapEntries = [
  "/",
  "/bilgi-merkezi",
  "/konut-kredisi",
  ...housingLoans.map((loan) => `/konut-kredisi/${loan.slug}`),
  "/kredi-kartlari",
  ...creditCards.map((card) => `/kredi-kartlari/${card.slug}`),
  "/araclar/kredi-hesaplama",
  ...bankProfiles.map((bank) => `/bankalar/${bank.slug}`),
  "/piyasalar/bist-100",
  "/uzaktan-musteri-edinimi",
].map((path) => ({ path }));

for (const article of knowledgeArticles) {
  sitemapEntries.push({ path: `/bilgi-merkezi/${article.slug}`, lastModified: article.updatedAt });
}

const redirects = new Map([
  [
    "/eski-konut-kredisi",
    {
      type: "redirect",
      destination: "/konut-kredisi?source=legacy#cms-fragment",
      status: 301,
    },
  ],
  ["/kaldirildi", { type: "gone" }],
]);

// Answers server/middleware/redirect-rules.ts: "here is the URL a visitor asked
// for — is it still a page, or does it move somewhere?" Separate from the CMS
// redirect map above on purpose: that contract is the platform's, this one is
// the product's, and they are curated by different people.
const routingDecisions = new Map([
  [
    "/eski-kredi-karti",
    { action: "redirect", location: "/kredi-kartlari?source=rules", status: 301 },
  ],
  ["/kampanya", { action: "redirect", location: "/kredi-kartlari?source=campaign", status: 307 }],
]);

function json(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(data));
}

function empty(response, status = 204) {
  response.writeHead(status, { "cache-control": "no-store", "access-control-allow-origin": "*" });
  response.end();
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function issueTokens() {
  const accessToken = `${base64UrlJson({ alg: "none", typ: "JWT" })}.${base64UrlJson({
    sub: "mock-user-1",
    name: "Cem Bakca",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.mock`;
  return { accessToken, refreshToken: `rt-${crypto.randomUUID()}` };
}

function bearerPayload(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (!token || token.includes("invalid") || token.includes("rejected")) return null;

  const segment = token.split(".")[1];
  if (!segment) return { sub: token.slice(-4) || "user" };
  try {
    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function profileFromPayload(payload) {
  const displayName = typeof payload.name === "string" ? payload.name : `User ${payload.sub}`;
  return {
    displayName,
    initials: displayName
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  };
}

async function route(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") return empty(response);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { ok: true, service: "origin-loom-mock-gw" });
  }
  if (request.method === "GET" && url.pathname === "/pages/menuitem/list") {
    return json(response, 200, menu);
  }
  if (request.method === "GET" && url.pathname === "/routing/domains") {
    return json(response, 200, routeDomains);
  }
  if (request.method === "GET" && url.pathname === "/seo/sitemap") {
    return json(response, 200, { entries: sitemapEntries });
  }
  if (resolveMarketStreamRequest(request, response, url)) return;
  const publicCatalogResponse =
    (await resolveFinanceRequest(request, url, readJson)) ??
    resolveKnowledgeCenterRequest(request, url) ??
    resolveMarketsRequest(request, url);
  if (publicCatalogResponse) {
    return json(response, publicCatalogResponse.status, publicCatalogResponse.body);
  }
  if (request.method === "GET" && url.pathname === "/cms/redirects") {
    const rule = redirects.get(url.searchParams.get("path") ?? "");
    return rule ? json(response, 200, rule) : empty(response, 404);
  }
  // Always answers: "next" is a decision, not a missing one, so the middleware
  // never has to read a 404 as consent to carry on.
  if (request.method === "GET" && url.pathname === "/routing/decide") {
    let pathname;
    try {
      pathname = new URL(url.searchParams.get("url") ?? "").pathname;
    } catch {
      return json(response, 400, { error: "invalid_url" });
    }
    return json(response, 200, routingDecisions.get(pathname) ?? { action: "next" });
  }
  if (request.method === "POST" && url.pathname === "/analytics/bot") {
    const body = await readJson(request);
    if (!isBotAnalyticsBatch(body)) {
      return json(response, 400, { error: "invalid bot analytics batch" });
    }
    return empty(response, 202);
  }
  if (request.method === "POST" && url.pathname === "/auth/login") {
    return json(response, 200, issueTokens());
  }
  if (request.method === "POST" && url.pathname === "/auth/refresh") {
    const body = await readJson(request);
    if (
      typeof body.refreshToken !== "string" ||
      body.refreshToken.length < 8 ||
      body.refreshToken.includes("invalid")
    ) {
      return json(response, 401, { error: "invalid refresh token" });
    }
    return json(response, 200, issueTokens());
  }
  if (request.method === "GET" && url.pathname === "/user/profile") {
    const payload = bearerPayload(request);
    if (!payload) return json(response, 401, { error: "unauthorized" });
    return json(response, 200, profileFromPayload(payload));
  }
  if (request.method === "GET" && url.pathname === "/account/summary") {
    const payload = bearerPayload(request);
    if (!payload) return json(response, 401, { error: "unauthorized" });
    return json(response, 200, {
      profile: profileFromPayload(payload),
      recentActivity: [
        {
          id: "act-1",
          label: "Konut kredisi karşılaştırması görüntülendi",
          at: new Date(Date.now() - 3_600_000).toISOString(),
        },
        {
          id: "act-2",
          label: "Bilgi Merkezi rehberi okundu",
          at: new Date(Date.now() - 86_400_000).toISOString(),
        },
        {
          id: "act-3",
          label: "Kredi kartı detay sayfası ziyaret edildi",
          at: new Date(Date.now() - 172_800_000).toISOString(),
        },
      ],
      stats: { comparisonsThisMonth: 4, savedOffers: 2 },
    });
  }
  return json(response, 404, { error: "mock gateway route not found", path: url.pathname });
}

function isBotAnalyticsBatch(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.events)) return false;
  if (value.events.length === 0 || value.events.length > 100) return false;
  return value.events.every(
    (event) =>
      event &&
      typeof event === "object" &&
      typeof event.pathname === "string" &&
      event.pathname.length > 0 &&
      event.pathname.length <= 2_048 &&
      typeof event.userAgent === "string" &&
      event.userAgent.length > 0 &&
      event.userAgent.length <= 512 &&
      (event.trackingId === undefined ||
        (typeof event.trackingId === "string" && event.trackingId.length <= 128)),
  );
}

export function createMockGatewayServer() {
  return createServer((request, response) => {
    const started = Date.now();
    void route(request, response)
      .catch((error) => {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (!quiet) {
          console.log(
            JSON.stringify({
              service: "mock-gw",
              method: request.method,
              path: request.url,
              status: response.statusCode,
              durationMs: Date.now() - started,
            }),
          );
        }
      });
  });
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const server = createMockGatewayServer();
  server.listen(port, host, () => {
    if (!quiet) {
      console.log(JSON.stringify({ service: "mock-gw", msg: "server started", host, port }));
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
