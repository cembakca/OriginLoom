import { handleBlogsApi } from "@server/api/blogs";
import { getPaginatedBlogs, parseOrderByParam } from "@server/services/blogs";
import { describe, expect, it } from "vitest";

describe("blogs API", () => {
  it("returns paginated blogs as JSON", async () => {
    const res = await handleBlogsApi(
      new Request("http://localhost/api/blogs?page=1&orderBy=date-desc"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; orderBy: string; posts: unknown[] };
    expect(body.page).toBe(1);
    expect(body.orderBy).toBe("date-desc");
    expect(body.posts).toHaveLength(6);
  });

  it("supports orderBy query param", async () => {
    const res = await handleBlogsApi(
      new Request("http://localhost/api/blogs?page=1&orderBy=title-asc"),
    );
    const body = (await res.json()) as { posts: Array<{ title: string }> };
    const titles = body.posts.map((p) => p.title);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b, "tr"));
    expect(titles).toEqual(sorted);
  });
});

describe("blogs orderBy", () => {
  it("parses orderBy param with fallback", () => {
    expect(parseOrderByParam("title-asc")).toBe("title-asc");
    expect(parseOrderByParam("invalid")).toBe("date-desc");
    expect(parseOrderByParam(null)).toBe("date-desc");
  });

  it("sorts by read time descending", async () => {
    const result = await getPaginatedBlogs(1, { orderBy: "read-time-desc" });
    const times = result.posts.map((p) => p.readTimeMin);
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  it("same page different orderBy returns different first post", async () => {
    const asc = await getPaginatedBlogs(1, { orderBy: "title-asc" });
    const desc = await getPaginatedBlogs(1, { orderBy: "title-desc" });
    expect(asc.posts[0]?.id).not.toBe(desc.posts[0]?.id);
  });
});
