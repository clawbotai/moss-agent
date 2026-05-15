import { buildContextPackage, saveContextSnapshot } from "@/lib/server/context";
import { createTask, getTask } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";
import { switchAgentSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const { agent } = switchAgentSchema.parse(await request.json());
    const source = getTask(taskId);
    if (!source) throw new Error("任务不存在");
    if (["queued", "running", "stuck"].includes(source.status)) {
      getScheduler().cancel(source.id);
    }

    const contextPackage = await buildContextPackage(taskId, {
      extraInstruction: `切换为 ${agent} 继续执行。`,
    });
    saveContextSnapshot(taskId, null, contextPackage);

    const task = createTask({
      projectId: source.projectId,
      parentTaskId: source.id,
      prompt: [
        `[从任务 ${source.title} 切换 agent 继续]`,
        "",
        `请切换为 ${agent}，基于父任务摘要继续执行。`,
      ].join("\n"),
      mode: agent === "codex" ? "codexOnly" : "claudeOnly",
      targetAgent: agent,
      budget: source.budget,
      permission: source.permission,
      memoryMode: source.memoryMode,
      contextPolicy: contextPackage.policy,
    });
    getScheduler().enqueue(task.id);
    return jsonOk({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
