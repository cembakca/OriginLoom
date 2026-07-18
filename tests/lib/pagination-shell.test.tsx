import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaginationShell } from "~/features/blogs-paginated/pagination-shell";

describe("pagination SSR shell", () => {
  it("renders crawler-visible anchors and a non-link current page", () => {
    const html = renderToStaticMarkup(<PaginationShell page={2} totalPages={4} />);

    expect(html).toContain('<a href="/blogs/paginated" rel="prev"');
    expect(html).toContain('<a href="/blogs/paginated?page=3" rel="next"');
    expect(html).toContain('<a href="/blogs/paginated?page=4"');
    expect(html).toContain('<span aria-current="page"');
    expect(html).not.toContain('<a href="/blogs/paginated?page=2"');
    expect(html).not.toContain("<button");
  });

  it("renders disabled text instead of invalid previous/next links at boundaries", () => {
    const first = renderToStaticMarkup(<PaginationShell page={1} totalPages={4} />);
    const last = renderToStaticMarkup(<PaginationShell page={4} totalPages={4} />);

    expect(first).toContain('<span aria-disabled="true"');
    expect(first).not.toContain('rel="prev"');
    expect(last).not.toContain('rel="next"');
  });
});
