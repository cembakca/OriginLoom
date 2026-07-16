import { getPaginatedBlogs, parsePageParam } from "@server/services/blogs";
import { describe, expect, it } from "vitest";

describe("blogs service", () => {
  it("returns first page by default", async () => {
    const result = await getPaginatedBlogs(1);
    expect(result.page).toBe(1);
    expect(result.posts).toHaveLength(6);
    expect(result.total).toBe(24);
    expect(result.totalPages).toBe(4);
  });

  it("returns page 2 posts (default date-desc)", async () => {
    const result = await getPaginatedBlogs(2);
    expect(result.page).toBe(2);
    expect(result.posts[0]?.id).toBe("blog-18");
  });

  it("returns page 2 posts in chronological order", async () => {
    const result = await getPaginatedBlogs(2, { orderBy: "date-asc" });
    expect(result.posts[0]?.id).toBe("blog-7");
  });

  it("clamps invalid page numbers", async () => {
    const low = await getPaginatedBlogs(0);
    expect(low.page).toBe(1);

    const high = await getPaginatedBlogs(99);
    expect(high.page).toBe(4);
  });

  it("parses page query param", () => {
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("-1")).toBe(1);
  });
});
