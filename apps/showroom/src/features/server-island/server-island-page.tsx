import { ServerIsland } from "@originloom/react/lib/server-island";

import { Container } from "~/components/ui/container";

export function ServerIslandPage({ payload }: { payload: string }) {
  return (
    <Container className="py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Server island</h1>
      <p className="mt-3 max-w-2xl text-slate-600">
        Bu sayfanın tamamı paylaşılan cache&apos;ten geliyor — anahtarında ziyaretçiye ait hiçbir
        boyut yok. Aşağıdaki kutu bir <em>delik</em>: cache&apos;li HTML&apos;de imzalı bir yer
        tutucu olarak duruyor, sunucu onu istek başına doldurup yerine koyuyor.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-slate-500">
        <code>defer</code> island&apos;dan farkı: orada bileşen tarayıcıya inip kendi verisini
        çeker. Burada işaretleme sunucuda üretilir, istemciye bileşen JavaScript&apos;i hiç gitmez.
        Script kapalıysa aşağıdaki yedek içerik olduğu gibi kalır.
      </p>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Ziyaretçi özeti
        </h2>
        <ServerIsland name="visitor-summary" payload={payload} path="/server-island">
          {/* Fallback: what a visitor sees before the fill lands, and what they
              keep seeing if it fails or scripts never run. */}
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
            Ziyaretçi özeti yükleniyor…
          </p>
        </ServerIsland>
      </section>
    </Container>
  );
}
