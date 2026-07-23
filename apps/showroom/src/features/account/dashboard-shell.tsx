import { Card, CardContent } from "~/components/ui/card";

/** SSR fallback — defer island mount öncesi iskelet. */
export function AccountDashboardShell() {
  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-2 pt-6">
        <h1 className="text-2xl font-bold text-slate-900">Hesabım</h1>
        <p className="text-sm text-slate-500">Hesap özeti yükleniyor…</p>
      </CardContent>
    </Card>
  );
}
