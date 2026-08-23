import { Container } from "~/components/ui/container";

export function PreviewDemoPage({
  preview,
  revision,
}: {
  preview: boolean;
  revision: { title: string; body: string };
}) {
  return (
    <Container className="py-10">
      {preview ? (
        <div
          className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="preview-banner"
        >
          <strong>Taslak modu açık.</strong>
          <span>Bu yanıt cache&apos;lenmiyor ve yalnızca sana gösteriliyor.</span>
          <a className="font-medium underline" href="/api/preview/disable?path=/preview-demo">
            Taslak modundan çık
          </a>
        </div>
      ) : null}

      <h1 className="text-2xl font-semibold text-slate-900" data-testid="revision-title">
        {revision.title}
      </h1>
      <p className="mt-3 max-w-2xl text-slate-600">{revision.body}</p>

      <section className="mt-8 space-y-2 text-sm text-slate-500">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nasıl denenir
        </h2>
        <p>
          <code>PREVIEW_SECRET</code> ile{" "}
          <code>/api/preview/enable?token=…&amp;path=/preview-demo</code> adresine git. Çerez set
          edilir ve bu sayfa taslağı göstermeye başlar.
        </p>
        <p>
          Yanıt başlıklarına bak: normalde <code>x-cache: HIT</code>, taslak modunda{" "}
          <code>BYPASS</code> ve <code>cache-control: private, no-store</code>.
        </p>
      </section>
    </Container>
  );
}
