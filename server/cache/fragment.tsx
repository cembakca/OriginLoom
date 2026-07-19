import { createHash } from "node:crypto";

import { config } from "@server/config";
import { isRequestDeadlineError } from "@server/middleware/request-deadline";
import { getPopularKnowledgeArticles } from "@server/services/knowledge-center";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { Footer } from "~/components/layout/footer";
import { Header } from "~/components/layout/header";
import { PopularKnowledgeArticles } from "~/features/knowledge-center/popular-articles";
import type { DeviceType } from "~/lib/device";
import type { ShellData } from "~/lib/shell-data";
import type { CachePolicy, Ctx } from "~/lib/types";

import { coalesceColdMiss } from "./cold-fill";

export function headerFragmentKey(device: DeviceType): string {
  return `fragment:header:${device}`;
}

export function footerFragmentKey(device: DeviceType): string {
  return `fragment:footer:${device}`;
}

type FragmentDefinition = {
  requiresShell: boolean;
  resolveOnFreshDocument: boolean;
  ttl: number;
  key: (shell: ShellData | null, ctx: Ctx) => string;
  resolve: (shell: ShellData | null, ctx: Ctx) => Promise<ReactElement> | ReactElement;
};

/**
 * Every fragment owns its cache variation and freshness contract. Request-dependent
 * data must be represented in `key`; private/user-specific fragments are forbidden.
 */
const fragmentRegistry: Record<string, FragmentDefinition> = {
  header: {
    requiresShell: true,
    resolveOnFreshDocument: false,
    ttl: config.menuCacheTtl,
    key: (shell) =>
      `${headerFragmentKey(requireShell(shell).deviceType)}:${menuFingerprint(shell)}`,
    resolve: (shell) => {
      const resolved = requireShell(shell);
      return <Header menu={resolved.menu!} deviceType={resolved.deviceType} />;
    },
  },
  footer: {
    requiresShell: true,
    resolveOnFreshDocument: false,
    ttl: config.menuCacheTtl,
    key: (shell) =>
      `${footerFragmentKey(requireShell(shell).deviceType)}:${menuFingerprint(shell)}`,
    resolve: (shell) => {
      const resolved = requireShell(shell);
      return <Footer menu={resolved.menu!} deviceType={resolved.deviceType} />;
    },
  },
  "popular-knowledge-articles": {
    requiresShell: false,
    resolveOnFreshDocument: true,
    ttl: 300,
    key: () => "fragment:popular-knowledge-articles:v1",
    resolve: async (_shell, ctx) => {
      const data = await getPopularKnowledgeArticles(ctx.request.signal);
      return <PopularKnowledgeArticles items={data.items} />;
    },
  },
};

export function fragmentRequiresShell(name: string): boolean {
  return fragmentRegistry[name]?.requiresShell ?? false;
}

export function shouldResolveFragment(name: string, cachedDocument: boolean): boolean {
  const definition = fragmentRegistry[name];
  return definition ? cachedDocument || definition.resolveOnFreshDocument : true;
}

export function fragmentCacheKey(name: string, shell: ShellData | null, ctx: Ctx): string {
  const definition = fragmentRegistry[name];
  if (!definition) throw new Error(`Bilinmeyen fragment resolver: ${name}`);
  return definition.key(shell, ctx);
}

/**
 * Resolves a fragment by name.
 * Cold misses share the existing process + Redis distributed coalescing path.
 */
export async function getOrSetFragmentByName(
  name: string,
  shell: ShellData | null,
  ctx: Ctx,
): Promise<string> {
  const definition = fragmentRegistry[name];
  if (!definition) {
    throw new Error(`Bilinmeyen fragment resolver: ${name}`);
  }
  if (ctx.request.signal.aborted) throw abortReason(ctx.request.signal);

  const key = fragmentCacheKey(name, shell, ctx);
  const policy: CachePolicy = { kind: "shared", ttl: definition.ttl, key: [key] };
  const pending = coalesceColdMiss({
    key,
    policy,
    work: async () => {
      const element = await definition.resolve(shell, ctx);
      const html = renderToString(element);
      return { value: html, body: html, cacheable: true, terminal: false };
    },
    isTimeout: (error) =>
      isRequestDeadlineError(error) || isRequestDeadlineError(ctx.request.signal.reason),
  });
  const result = await waitForSignal(pending, ctx.request.signal);
  return result.kind === "cache" ? result.body : result.work.value;
}

// Keep thin wrappers for compatibility with existing tests
export async function getOrSetHeaderFragment(
  device: DeviceType,
  shell: ShellData,
): Promise<string> {
  return getOrSetFragmentByName("header", { ...shell, deviceType: device }, fragmentTestContext());
}

export async function getOrSetFooterFragment(
  device: DeviceType,
  shell: ShellData,
): Promise<string> {
  return getOrSetFragmentByName("footer", { ...shell, deviceType: device }, fragmentTestContext());
}

function requireShell(shell: ShellData | null): ShellData {
  if (!shell?.menu) throw new Error("Fragment requires public shell menu data");
  return shell;
}

function menuFingerprint(shell: ShellData | null): string {
  const menu = requireShell(shell).menu;
  return createHash("sha256").update(JSON.stringify(menu)).digest("base64url").slice(0, 12);
}

function waitForSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function fragmentTestContext(): Ctx {
  const request = new Request("http://localhost/");
  return {
    request,
    params: {},
    url: new URL(request.url),
    publicPath: "/",
  };
}
