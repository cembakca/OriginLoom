import { ClientApiError } from "@originloom/react/lib/client/api-fetch";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useAccountSummary } from "~/lib/query/hooks/use-account-summary";

/** Kişisel hesap paneli — defer island, TanStack Query + BFF. */
export default function AccountDashboard() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAccountSummary();

  if (isLoading) {
    return (
      <Card className="max-w-lg animate-pulse">
        <CardContent className="space-y-3 pt-6">
          <div className="h-6 w-24 rounded bg-slate-200" />
          <div className="h-8 w-48 rounded bg-slate-200" />
          <div className="h-4 w-full rounded bg-slate-100" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    const unauthorized = error instanceof ClientApiError && error.status === 401;
    return (
      <Card
        className={`max-w-lg ${unauthorized ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}
      >
        <CardContent className="space-y-2 pt-6">
          <h1 className="text-2xl font-bold">{unauthorized ? "Giriş gerekli" : "Hata"}</h1>
          <p className="text-sm text-slate-700">
            {unauthorized
              ? "Hesap özeti için access_token veya refresh_token cookie ekleyin."
              : error instanceof Error
                ? error.message
                : "Bilinmeyen hata"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { profile, recentActivity, stats } = data;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <Badge>Hesap</Badge>
          <h1 className="text-2xl font-bold">Hesabım</h1>
          <p className="text-slate-600">
            Hoş geldin, <span className="font-semibold text-slate-900">{profile.displayName}</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Bu ay karşılaştırma
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-slate-900">{stats.comparisonsThisMonth}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Kayıtlı teklif</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-slate-900">{stats.savedOffers}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Son aktivite</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {recentActivity.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 text-sm">
                <span className="text-slate-800">{item.label}</span>
                <time className="shrink-0 text-slate-500" dateTime={item.at}>
                  {new Date(item.at).toLocaleDateString("tr-TR")}
                </time>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-4 text-sm font-medium text-brand-700 hover:text-brand-800 disabled:opacity-50"
          >
            {isFetching ? "Yenileniyor…" : "Yenile"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
