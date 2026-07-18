import { buttonVariants } from "~/components/ui/button";
import { blogPaginationHref, buildPaginationItems } from "~/lib/pagination";
import { cn } from "~/lib/utils";

/** Pure SSR navigation: crawlers and no-JS users receive the complete link graph. */
export function PaginationShell({ page, totalPages }: { page: number; totalPages: number }) {
  const items = buildPaginationItems(page, totalPages);
  const linkClass = buttonVariants({ variant: "secondary", size: "sm" });
  const disabledClass = cn(linkClass, "pointer-events-none opacity-50");

  return (
    <nav aria-label="Sayfalama" className="mt-6 flex flex-wrap gap-2">
      {page > 1 ? (
        <a href={blogPaginationHref(page - 1)} rel="prev" className={linkClass}>
          ← Önceki
        </a>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          ← Önceki
        </span>
      )}

      {items.map((item) =>
        item.kind === "ellipsis" ? (
          <span
            key={`ellipsis-${item.key}`}
            aria-hidden="true"
            className="px-1 py-2 text-slate-500"
          >
            …
          </span>
        ) : item.page === page ? (
          <span
            key={item.page}
            aria-current="page"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            {item.page}
          </span>
        ) : (
          <a key={item.page} href={blogPaginationHref(item.page)} className={linkClass}>
            {item.page}
          </a>
        ),
      )}

      {page < totalPages ? (
        <a href={blogPaginationHref(page + 1)} rel="next" className={linkClass}>
          Sonraki →
        </a>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Sonraki →
        </span>
      )}
    </nav>
  );
}
