import { createTaskMessage, getTask, getTaskWithRelations, listTaskMessages } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";
import { validateSkillSelection } from "@/lib/server/skills";
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
    if (input.skillSelection) {
      const effectiveMode = input.mode || getTask(taskId)?.mode || "collaborative";
      const validation = validateSkillSelection(input.skillSelection, effectiveMode);
      if (!validation.ok) {
        return jsonError(new Error(validation.errors.join("; ")), 400);
      }
    }
    const message = createTaskMessage({
      taskId,
      role: "user",
      content: input.content,
      includeInContext: input.includeInContext,
      skillSelection: input.skillSelection,
    });
    try {
      getScheduler().continueAfterMessage(taskId, input.mode, input.skillSelection);
    } catch (notifyError) {
      console.warn("追加任务调度失败，前端将通过响应刷新", notifyError);
    }
    const task = getTaskWithRelations(taskId);
    return jsonOk({ message, task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
