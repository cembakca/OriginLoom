import { getOrSetFragmentByName } from "@originloom/core/cache/fragment";
import type { FragmentDefinition } from "@originloom/core/runtime";
import type { Ctx } from "@originloom/react/lib/types";
import { deviceCacheFragment, type DeviceType } from "@originloom/shared/lib/device";
import { productConfig } from "@server/product/config";
import { getPopularKnowledgeArticles } from "@server/services/knowledge-center";

import { Footer } from "~/components/layout/footer";
import { Header } from "~/components/layout/header";
import { PopularKnowledgeArticles } from "~/features/knowledge-center/popular-articles";
import { CacheTag } from "~/lib/cache-keys";
import type { ShellData } from "~/lib/shell-data";

export function headerFragmentKey(device: DeviceType): string {
  return `fragment:header:${device}`;
}

export function footerFragmentKey(device: DeviceType): string {
  return `fragment:footer:${device}`;
}

export const productFragments: Record<string, FragmentDefinition<ShellData>> = {
  header: {
    requiresShell: true,
    resolveOnFreshDocument: false,
    ttl: productConfig.menuCacheTtl,
    swr: productConfig.menuCacheTtl,
    tags: [CacheTag.menu],
    keyFromRequest: (ctx) => headerFragmentKey(deviceCacheFragment(ctx.request)),
    resolve: (shell) => {
      const resolved = requireShell(shell);
      return <Header menu={resolved.menu!} deviceType={resolved.deviceType} />;
    },
  },
  footer: {
    requiresShell: true,
    resolveOnFreshDocument: false,
    ttl: productConfig.menuCacheTtl,
    swr: productConfig.menuCacheTtl,
    tags: [CacheTag.menu],
    keyFromRequest: (ctx) => footerFragmentKey(deviceCacheFragment(ctx.request)),
    resolve: (shell) => {
      const resolved = requireShell(shell);
      return <Footer menu={resolved.menu!} deviceType={resolved.deviceType} />;
    },
  },
  "popular-knowledge-articles": {
    requiresShell: false,
    resolveOnFreshDocument: true,
    ttl: 300,
    swr: 300,
    timeoutMs: 1_500,
    tags: [CacheTag.popularKnowledge],
    keyFromRequest: () => "fragment:popular-knowledge-articles:v1",
    resolve: async (_shell, ctx) => {
      const data = await getPopularKnowledgeArticles(ctx.request);
      return <PopularKnowledgeArticles items={data.items} />;
    },
    fallback: () => <PopularKnowledgeArticles items={[]} />,
  },
};

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

function fragmentTestContext(): Ctx {
  const request = new Request("http://localhost/");
  return {
    request,
    params: {},
    url: new URL(request.url),
    publicPath: "/",
  };
}
