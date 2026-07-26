import type { Assets } from "@originloom/core/assets";
import { closeCache, initCache, read } from "@originloom/core/cache";
import { getOrSetFragmentByName } from "@originloom/core/cache/fragment";
import { stitchCachedHtml } from "@originloom/core/cache/stitch-fragments";
import { renderDocument, renderDocumentToStream, streamToString } from "@originloom/core/document";
import { renderNotFoundDocument, renderRouteErrorDocument } from "@originloom/core/route-boundary";
import { installRuntime, type OriginRuntime } from "@originloom/core/runtime";
import { ssrFragmentPlaceholder } from "@originloom/shared/fragment-markup";
import type { ResolvedMetadata } from "@originloom/shared/lib/metadata/types";
import type { Ctx, Route } from "@originloom/shared/lib/types";
import type { FrameworkNode, OriginRenderer } from "@originloom/shared/render";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Proof that the render seam is real: a renderer with no React in it at all
 * drives the whole server pipeline — documents, streaming, boundary pages and
 * the fragment cache. Greps show React is absent from the core; this shows the
 * core does not secretly need it.
 */
type VanillaNode = { html: string };

const node = (html: string): VanillaNode => ({ html });
const asNode = (value: FrameworkNode): VanillaNode => value as VanillaNode;

type Shell = { brand: string };

const vanillaRenderer: OriginRenderer<Shell> = {
  routeContent(route, data) {
    return route.Component({ data });
  },
  notFoundContent(_ctx, route) {
    return route?.NotFoundComponent?.() ?? node("<p>404</p>");
  },
  errorContent(_ctx, _route, error, status) {
    return node(`<p>${status}${error ? `: ${error.code}` : ""}</p>`);
  },
  renderNode(value) {
    return asNode(value).html;
  },
  renderDocument(input) {
    return `<!DOCTYPE html><html lang="${input.htmlLang}"><head><title>${input.seo.title}</title>${input.assets.css
      .map((href) => `<link rel="stylesheet" href="${href}"/>`)
      .join("")}</head><body><div id="root"><header>${input.shell.brand}</header>${
      asNode(input.content).html
    }</div><script type="module" src="${input.assets.js}"></script></body></html>`;
  },
  async renderDocumentToStream(input) {
    const html = this.renderDocument(input);
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(html));
          controller.close();
        },
      }),
      abort: () => undefined,
      allReady: Promise.resolve(),
    };
  },
};

const metadata: ResolvedMetadata = {
  applicationName: "Vanilla",
  siteName: "Vanilla",
  title: "Vanilla sayfa",
  description: "",
  canonical: "https://example.com/vanilla",
  robots: "index, follow",
  openGraph: { title: "Vanilla sayfa", description: "", url: "https://example.com/vanilla" },
  twitter: { card: "summary", title: "Vanilla sayfa", description: "" },
  icons: { icon: "/favicon.ico" },
  verification: {},
  pagination: {},
  formatDetection: { telephone: false },
  structuredData: [],
};

const assets: Assets = { js: "/assets/entry.js", css: ["/assets/app.css"], fonts: [] };

const vanillaRuntime: OriginRuntime<Shell> = {
  renderer: vanillaRenderer,
  fragments: {
    clock: {
      requiresShell: true,
      resolveOnFreshDocument: true,
      ttl: 60,
      key: (shell) => `fragment:clock:${shell?.brand ?? "none"}`,
      resolve: (shell) => node(`<span>${shell?.brand ?? "none"} saati</span>`),
    },
  },
  buildShellData: async () => ({ brand: "Vanilla" }),
  isShellUsableForFragments: (shell) => Boolean(shell.brand),
  document: {
    htmlLang: "tr",
    isBotRequest: () => false,
    resolveMetadata: () => metadata,
    boundaryMetadata: () => metadata,
    defaultPageMeta: (ctx, pageType) => ({ pageType, publicPath: ctx.publicPath }),
  },
  cacheKeys: { isKnownPageCachePrefix: (prefix) => prefix === "vanilla" },
};

function context(pathname = "/vanilla"): Ctx {
  return {
    request: new Request(`http://localhost${pathname}`),
    params: {},
    url: new URL(`http://localhost${pathname}`),
    publicPath: pathname,
  };
}

const route: Route<{ heading: string }, VanillaNode> = {
  path: "/vanilla",
  loader: async () => ({ data: { heading: "Merhaba" } }),
  Component: ({ data }) => node(`<h1>${data.heading}</h1>`),
};

describe("a renderer without React drives the server pipeline", () => {
  beforeEach(async () => {
    // Replaces the product runtime installed by tests/setup-runtime.ts.
    installRuntime(vanillaRuntime);
    process.env.CACHE_BACKEND = "memory";
    await closeCache();
    await initCache();
  });

  afterEach(async () => {
    await closeCache();
  });

  it("renders a full document", async () => {
    const html = await renderDocument(route, { heading: "Merhaba" }, assets, {
      routeCtx: context(),
    });

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="tr">');
    expect(html).toContain("<title>Vanilla sayfa</title>");
    expect(html).toContain("<header>Vanilla</header>"); // shell built by the core
    expect(html).toContain("<h1>Merhaba</h1>"); // route content
    expect(html).toContain('<link rel="stylesheet" href="/assets/app.css"/>');
    expect(html).not.toMatch(/react/i);
  });

  it("streams a document and collapses the stream back to a string", async () => {
    const streamResult = await renderDocumentToStream(
      { ...route, streaming: true },
      { heading: "Akış" },
      assets,
      { routeCtx: context() },
      () => undefined,
    );

    await streamResult.allReady;
    expect(await streamToString(streamResult.stream)).toContain("<h1>Akış</h1>");
  });

  it("renders the 404 and error boundaries", async () => {
    const notFound = await renderNotFoundDocument(assets, context("/yok"));
    expect(notFound).toContain("<p>404</p>");

    const routeError = await renderRouteErrorDocument(
      assets,
      context(),
      route,
      { code: "gateway_down", message: "safe" },
      503,
    );
    expect(routeError).toContain("<p>503: gateway_down</p>");
  });

  it("renders and caches a fragment through the renderer", async () => {
    const ctx = context();
    const shell = { brand: "Vanilla" };

    const html = await getOrSetFragmentByName("clock", shell, ctx);
    expect(html).toBe("<span>Vanilla saati</span>");
    expect((await read("fragment:clock:Vanilla"))?.body).toBe(html);
  });

  it("stitches fresh fragments into cached HTML", async () => {
    const cached = `<main>${ssrFragmentPlaceholder("clock", "<span>eski</span>")}</main>`;

    const stitched = await stitchCachedHtml(cached, route, context(), true);

    expect(stitched).toContain("<span>Vanilla saati</span>");
    expect(stitched).not.toContain("<span>eski</span>");
  });
});
