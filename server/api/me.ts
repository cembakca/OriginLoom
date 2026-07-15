import { getMe } from "../../src/services/user";
import { cookie } from "../../src/lib/request";

export async function handleMe(request: Request): Promise<Response> {
  const sid = cookie(request, "sid");
  if (!sid) return new Response(null, { status: 401 });

  const me = await getMe(sid);
  if (!me) return new Response(null, { status: 401 });

  return Response.json(me, {
    headers: { "cache-control": "private, no-store" },
  });
}
