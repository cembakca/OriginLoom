import { getPaginatedBlogs, parseOrderByParam, parsePageParam } from "~/services/blogs";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Public BFF — client island blog sıralama/filtreleme. Pipeline dışı (anonim). */
export async function handleBlogsApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const page = parsePageParam(url.searchParams.get("page"));
  const orderBy = parseOrderByParam(url.searchParams.get("orderBy"));

  const data = await getPaginatedBlogs(page, { orderBy });
  return json(data);
}

export function mountBlogsApi(app: {
  get: (
    path: string,
    handler: (c: { req: { raw: Request } }) => Response | Promise<Response>,
  ) => void;
}): void {
  app.get("/api/blogs", (c) => handleBlogsApi(c.req.raw));
}
