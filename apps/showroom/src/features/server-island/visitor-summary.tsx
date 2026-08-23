import type { VisitorFacts } from "~/lib/visitor-facts";

/**
 * The markup a server island produces.
 *
 * It never runs in the browser: the server renders it to a string and the fill
 * runtime drops that string into the placeholder. So there is no hydration, no
 * event handler and no component JavaScript in the client bundle — which is the
 * difference between this and a `defer` island.
 */
export function VisitorSummary({
  facts,
  variant,
}: {
  facts: VisitorFacts;
  variant: "compact" | "full";
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="visitor-summary">
      <Fact label="Cihaz" value={facts.device} />
      <Fact label="Tekrar ziyaret" value={facts.returning ? "evet" : "hayır"} />
      {variant === "full" ? (
        <>
          <Fact label="Dil" value={facts.language} />
          <Fact label="Sunucuda render" value={facts.renderedAt} />
        </>
      ) : null}
    </dl>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-900">{value}</dd>
    </div>
  );
}
