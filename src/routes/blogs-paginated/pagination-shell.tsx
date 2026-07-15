const btnStyle = (active: boolean, disabled = false) =>
  ({
    padding: "0.5rem 0.875rem",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: active ? "#0f172a" : "#fff",
    color: active ? "#fff" : "#0f172a",
    cursor: disabled ? "not-allowed" : active ? "default" : "pointer",
    fontWeight: active ? 600 : 400,
    opacity: disabled ? 0.5 : 1,
  }) as const;

/** SSR shell — markup must match `islands/blog-pagination.tsx` for hydrate. */
export function PaginationShell({ page, totalPages }: { page: number; totalPages: number }) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav
      aria-label="Sayfalama"
      style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1.5rem" }}
      tabIndex={0}
    >
      <button type="button" disabled={page <= 1} style={btnStyle(false, page <= 1)}>
        ← Önceki
      </button>

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          aria-current={p === page ? "page" : undefined}
          style={btnStyle(p === page)}
        >
          {p}
        </button>
      ))}

      <button type="button" disabled={page >= totalPages} style={btnStyle(false, page >= totalPages)}>
        Sonraki →
      </button>
    </nav>
  );
}
