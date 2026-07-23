import { buttonVariants } from "~/components/ui/button";
import { buildPaginationItems } from "@originloom/react/lib/pagination";
import { cn } from "@originloom/react/lib/utils";

export function CatalogPagination({
  pathname,
  search,
  page,
  totalPages,
}: {
  pathname: string;
  search: URLSearchParams;
  page: number;
  totalPages: number;
}) {
  const items = buildPaginationItems(page, totalPages);
  const linkClass = buttonVariants({ variant: "secondary", size: "sm" });
  const disabledClass = cn(linkClass, "pointer-events-none opacity-50");
  const href = (target: number) => {
    const params = new URLSearchParams(search);
    if (target === 1) params.delete("page");
    else params.set("page", String(target));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap gap-2 pt-4">
      {page > 1 ? (
        <a href={href(page - 1)} rel="prev" className={linkClass}>
          ← Önceki
        </a>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          ← Önceki
        </span>
      )}
      {items.map((item) =>
        item.kind === "ellipsis" ? (
          <span key={item.key} aria-hidden="true" className="px-1 py-2 text-slate-500">
            …
          </span>
        ) : item.page === page ? (
          <span key={item.page} aria-current="page" className={buttonVariants({ size: "sm" })}>
            {item.page}
          </span>
        ) : (
          <a key={item.page} href={href(item.page)} className={linkClass}>
            {item.page}
          </a>
        ),
      )}
      {page < totalPages ? (
        <a href={href(page + 1)} rel="next" className={linkClass}>
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
