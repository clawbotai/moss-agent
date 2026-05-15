import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const body = await request.text();
    if (body) {
      try {
        JSON.parse(body);
      } catch {
        return jsonError(new Error("请求体不是有效 JSON"), 400);
      }
    }

    getScheduler().continue(taskId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
