import { useCallback } from "react";

import { Button } from "~/components/ui/button";
import { buildPaginationItems } from "~/lib/pagination";
import { cn } from "~/lib/utils";

type Props = { page: number; totalPages: number };

export default function BlogPagination({ page, totalPages }: Props) {
  const go = useCallback((nextPage: number) => {
    const url = new URL(location.href);
    url.searchParams.set("page", String(nextPage));
    location.href = url.toString();
  }, []);

  const items = buildPaginationItems(page, totalPages);

  return (
    <nav
      aria-label="Sayfalama"
      className="mt-6 flex flex-wrap gap-2"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && page > 1) go(page - 1);
        if (e.key === "ArrowRight" && page < totalPages) go(page + 1);
      }}
      tabIndex={0}
    >
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>
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
            onClick={() => item.page !== page && go(item.page)}
            className={cn(item.page === page && "pointer-events-none")}
          >
            {item.page}
          </Button>
        ),
      )}

      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => go(page + 1)}
      >
        Sonraki →
      </Button>
    </nav>
  );
}
