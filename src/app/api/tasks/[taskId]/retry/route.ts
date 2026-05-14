import { getScheduler } from "@/lib/server/scheduler";
import { jsonError, jsonOk } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    getScheduler().retry(taskId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
