import { getTaskWithRelations } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const task = getTaskWithRelations(taskId);
    if (!task) return jsonError(new Error("任务不存在"), 404);
    return jsonOk({ task });
  } catch (error) {
    return jsonError(error);
  }
}
