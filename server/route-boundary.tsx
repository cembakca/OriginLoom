import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { mergeMetadata } from "~/lib/metadata/merge";
import { defaultPageMeta } from "~/lib/shell-data";
import type { Ctx, Route, RouteError } from "~/lib/types";

import type { Assets } from "./assets";
import { renderDocumentView } from "./document";

export function NotFoundPage() {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <p className="text-sm font-semibold text-brand-700">404</p>
        <CardTitle>Aradığınız sayfa bulunamadı</CardTitle>
        <CardDescription>
          Adres değişmiş, içerik kaldırılmış veya bağlantı hatalı olabilir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <a className="font-medium text-brand-700 hover:underline" href="/">
          Ana sayfaya dön
        </a>
      </CardContent>
    </Card>
  );
}

export function RouteErrorPage({ error }: { error: RouteError | null; status: number }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <p className="text-sm font-semibold text-brand-700">Bir sorun oluştu</p>
        <CardTitle>Bu sayfa şu anda gösterilemiyor</CardTitle>
        <CardDescription>{error?.message ?? "Lütfen daha sonra tekrar deneyin."}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4">
        <button
          type="button"
          data-reload-page
          className="cursor-pointer border-0 bg-transparent p-0 font-medium text-brand-700 hover:underline"
        >
          Tekrar dene
        </button>
        <a className="font-medium text-slate-700 hover:underline" href="/">
          Ana sayfaya dön
        </a>
      </CardContent>
    </Card>
  );
}

export async function renderNotFoundDocument(
  assets: Assets,
  routeCtx: Ctx,
  route?: Route,
): Promise<string> {
  const Component = route?.NotFoundComponent ?? NotFoundPage;
  return renderDocumentView({
    assets,
    routeCtx,
    content: <Component />,
    metadata: mergeMetadata(
      {
        title: "Sayfa bulunamadı",
        description: "Aradığınız sayfa bulunamadı.",
        robots: { index: false, follow: false },
      },
      routeCtx,
    ),
    pageMeta: defaultPageMeta(routeCtx, "not-found"),
    ...(route?.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
  });
}

export async function renderRouteErrorDocument(
  assets: Assets,
  routeCtx: Ctx,
  route: Route,
  error: RouteError | null,
  status: number,
): Promise<string> {
  const Component = route.ErrorComponent ?? RouteErrorPage;
  return renderDocumentView({
    assets,
    routeCtx,
    content: <Component error={error} status={status} />,
    metadata: mergeMetadata(
      {
        title: "Sayfa gösterilemiyor",
        description: "Bu sayfa şu anda gösterilemiyor.",
        robots: { index: false, follow: false },
      },
      routeCtx,
    ),
    pageMeta: defaultPageMeta(routeCtx, "route-error"),
    ...(route.minimalChrome !== undefined ? { minimalChrome: route.minimalChrome } : {}),
  });
}
