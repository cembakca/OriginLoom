import { useCallback } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type Props = { page: number; totalPages: number };

export default function BlogPagination({ page, totalPages }: Props) {
  const go = useCallback((nextPage: number) => {
    const url = new URL(location.href);
    url.searchParams.set("page", String(nextPage));
    location.href = url.toString();
  }, []);

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

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

      {pages.map((p) => (
        <Button
          key={p}
          variant={p === page ? "default" : "secondary"}
          size="sm"
          aria-current={p === page ? "page" : undefined}
          onClick={() => p !== page && go(p)}
          className={cn(p === page && "pointer-events-none")}
        >
          {p}
        </Button>
      ))}

      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => go(page + 1)}>
        Sonraki →
      </Button>
    </nav>
  );
}
