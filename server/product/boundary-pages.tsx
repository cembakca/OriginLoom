import type { RouteError } from "@originloom/react/lib/types";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

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
