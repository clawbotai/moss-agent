import { createTaskMessage, getTaskWithRelations, listTaskMessages } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";
import { createTaskMessageSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const messages = listTaskMessages(taskId);
    return jsonOk({ messages });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const input = createTaskMessageSchema.parse(await request.json());
    const message = createTaskMessage({
      taskId,
      role: "user",
      content: input.content,
      includeInContext: input.includeInContext,
    });
    const task = getTaskWithRelations(taskId);
    try {
      getScheduler().notifyTaskUpdated(taskId);
    } catch (notifyError) {
      console.warn("消息广播失败，前端将通过响应刷新", notifyError);
    }
    return jsonOk({ message, task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
