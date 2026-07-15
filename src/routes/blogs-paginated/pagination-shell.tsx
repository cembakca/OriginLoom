import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** SSR shell — markup must match `islands/blog-pagination.tsx` for hydrate. */
export function PaginationShell({ page, totalPages }: { page: number; totalPages: number }) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav aria-label="Sayfalama" className="mt-6 flex flex-wrap gap-2" tabIndex={0}>
      <Button variant="secondary" size="sm" disabled={page <= 1}>
        ← Önceki
      </Button>

      {pages.map((p) => (
        <Button
          key={p}
          variant={p === page ? "default" : "secondary"}
          size="sm"
          aria-current={p === page ? "page" : undefined}
          className={cn(p === page && "pointer-events-none")}
        >
          {p}
        </Button>
      ))}

      <Button variant="secondary" size="sm" disabled={page >= totalPages}>
        Sonraki →
      </Button>
    </nav>
  );
}
