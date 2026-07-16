import { Button } from "~/components/ui/button";
import { buildPaginationItems } from "~/lib/pagination";
import { cn } from "~/lib/utils";

/** SSR shell — markup must match `islands/blog-pagination.tsx` for hydrate. */
export function PaginationShell({ page, totalPages }: { page: number; totalPages: number }) {
  const items = buildPaginationItems(page, totalPages);

  return (
    <nav aria-label="Sayfalama" className="mt-6 flex flex-wrap gap-2" tabIndex={0}>
      <Button variant="secondary" size="sm" disabled={page <= 1}>
        ← Önceki
      </Button>

      {items.map((item) =>
        item.kind === "ellipsis" ? (
          <span
            key={`ellipsis-${item.key}`}
            aria-hidden="true"
            className="px-1 py-2 text-slate-500"
          >
            …
          </span>
        ) : (
          <Button
            key={item.page}
            variant={item.page === page ? "default" : "secondary"}
            size="sm"
            aria-current={item.page === page ? "page" : undefined}
            className={cn(item.page === page && "pointer-events-none")}
          >
            {item.page}
          </Button>
        ),
      )}

      <Button variant="secondary" size="sm" disabled={page >= totalPages}>
        Sonraki →
      </Button>
    </nav>
  );
}
