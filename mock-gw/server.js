import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PORT ?? 4002);
const host = process.env.HOST ?? "0.0.0.0";
const quiet = process.env.MOCK_GW_QUIET === "1";

const AUTHORS = ["Ayşe Kaya", "Mehmet Demir", "Zeynep Arslan", "Can Yıldız"];
const TAGS = ["react", "ssr", "web", "performance", "typescript", "cache"];
const BANKS = ["Ziraat", "İş Bankası", "Garanti BBVA", "Akbank", "Yapı Kredi", "QNB"];
const routeDomains = {
  loanCities: ["istanbul", "ankara", "izmir"],
  recoursePages: ["kredi"],
};

const blogs = Array.from({ length: 24 }, (_, index) => {
  const number = index + 1;
  return {
    id: `blog-${number}`,
    slug: `blog-yazisi-${number}`,
    title: `SSR Kit ile Modern Web #${number}`,
    excerpt: `Sayfa ${Math.ceil(number / 6)} örneği — explicit cache key ve island mimarisiyle paginated blog listesi.`,
    author: AUTHORS[index % AUTHORS.length] ?? "Unknown",
    publishedAt: new Date(Date.UTC(2026, 0, number)).toISOString(),
    readTimeMin: 3 + (index % 5),
    tags: [TAGS[index % TAGS.length] ?? "web", TAGS[(index + 2) % TAGS.length] ?? "ssr"],
  };
});

const headerItems = [
  {
    id: 1,
    name: "Kredi",
    url: "/ihtiyac-kredisi/istanbul",
    displayOrder: 1,
    mobileDisplayOrder: 1,
    itemType: 4,
    subMenuItemList: [
      {
        id: 11,
        parentId: 1,
        name: "İhtiyaç Kredisi",
        url: "/ihtiyac-kredisi/istanbul",
        displayOrder: 1,
        mobileDisplayOrder: 1,
        itemType: 4,
      },
      {
        id: 12,
        parentId: 1,
        name: "Emekli Bankacılığı",
        hamburgerName: "Emekli",
        url: "/emekli-bankaciligi",
        displayOrder: 2,
        mobileDisplayOrder: 2,
        itemType: 4,
      },
    ],
  },
  {
    id: 2,
    name: "Blog",
    url: "/blogs/paginated",
    displayOrder: 2,
    mobileDisplayOrder: 3,
    itemType: 4,
  },
];

const menu = {
  headerItems,
  hamburgerItems: headerItems,
  footerItems: [
    {
      id: 100,
      name: "Hakkımızda",
      url: "/hakkimizda",
      displayOrder: 1,
      mobileDisplayOrder: 1,
      itemType: 16,
    },
    {
      id: 101,
      name: "Gizlilik",
      url: "/gizlilik.pdf",
      displayOrder: 2,
      mobileDisplayOrder: 2,
      itemType: 16,
    },
    {
      id: 102,
      name: "İletişim",
      url: "/iletisim",
      displayOrder: 3,
      mobileDisplayOrder: 3,
      itemType: 16,
    },
  ],
};

const retirementBankingPage = {
  headline: "Emekli Bankacılığı",
  seoInfo: {
    title: "Emekli Bankacılığı",
    metaDescription:
      "Emekli maaşınıza özel bankacılık ürünleri, promosyonlar ve avantajlı faiz oranları.",
    headingTitle: "Emekli Bankacılığı",
    heroDescription: "Emekliler için özel bankacılık çözümleri.",
    image: "https://cdn.hangikredi.com/og/retirement-banking.png",
    friendlyUrl: "/emekli-bankaciligi",
  },
};

const redirects = new Map([
  [
    "/eski-emeklilik",
    {
      type: "redirect",
      destination: "/emekli-bankaciligi?source=legacy#cms-fragment",
      status: 301,
    },
  ],
  ["/kaldirildi", { type: "gone" }],
]);

const validOrders = new Set(["date-desc", "date-asc", "title-asc", "title-desc", "read-time-desc"]);

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

function sortBlogs(orderBy) {
  const result = [...blogs];
  switch (orderBy) {
    case "date-asc":
      return result.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    case "title-asc":
      return result.sort((a, b) => a.title.localeCompare(b.title, "tr"));
    case "title-desc":
      return result.sort((a, b) => b.title.localeCompare(a.title, "tr"));
    case "read-time-desc":
      return result.sort((a, b) => b.readTimeMin - a.readTimeMin);
    default:
      return result.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
}

async function route(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") return empty(response);
  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { ok: true, service: "ssr-kit-mock-gw" });
  }
  if (request.method === "GET" && url.pathname === "/pages/menuitem/list") {
    return json(response, 200, menu);
  }
  if (request.method === "GET" && url.pathname === "/routing/domains") {
    return json(response, 200, routeDomains);
  }
  if (request.method === "GET" && url.pathname === "/pages/retirement-banking") {
    return json(response, 200, retirementBankingPage);
  }
  if (request.method === "GET" && url.pathname === "/cms/redirects") {
    const rule = redirects.get(url.searchParams.get("path") ?? "");
    return rule ? json(response, 200, rule) : empty(response, 404);
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
          label: "İhtiyaç kredisi karşılaştırma görüntülendi",
          at: new Date(Date.now() - 3_600_000).toISOString(),
        },
        {
          id: "act-2",
          label: "Blog yazısı okundu",
          at: new Date(Date.now() - 86_400_000).toISOString(),
        },
        {
          id: "act-3",
          label: "Emekli bankacılığı sayfası ziyaret edildi",
          at: new Date(Date.now() - 172_800_000).toISOString(),
        },
      ],
      stats: { comparisonsThisMonth: 4, savedOffers: 2 },
    });
  }
  if (request.method === "GET" && url.pathname === "/offers") {
    const city = url.searchParams.get("city") ?? "";
    if (!routeDomains.loanCities.includes(city)) {
      return json(response, 404, { error: "unknown city" });
    }
    const amount = Math.max(1, Number(url.searchParams.get("amount") ?? 50_000));
    const offers = BANKS.map((bank, index) => {
      const rate = 3.29 + index * 0.17;
      return {
        id: `${bank}-${amount}`,
        bank,
        rate,
        monthly: Math.round((amount * (1 + (rate / 100) * 36)) / 36),
      };
    });
    return json(response, 200, offers);
  }
  if (request.method === "GET" && url.pathname === "/blogs") {
    const requestedPage = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const requestedSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 6)));
    const rawOrder = url.searchParams.get("orderBy") ?? "date-desc";
    const orderBy = validOrders.has(rawOrder) ? rawOrder : "date-desc";
    const ordered = sortBlogs(orderBy);
    const totalPages = Math.max(1, Math.ceil(ordered.length / requestedSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * requestedSize;
    return json(response, 200, {
      posts: ordered.slice(start, start + requestedSize),
      page,
      pageSize: requestedSize,
      total: ordered.length,
      totalPages,
      orderBy,
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
