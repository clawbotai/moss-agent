import { createTask, getTask } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

const schema = z.object({
  agent: z.enum(["claude", "codex"]),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const { agent } = schema.parse(await request.json());
    const source = getTask(taskId);
    if (!source) throw new Error("任务不存在");
    if (["queued", "running", "stuck"].includes(source.status)) {
      getScheduler().cancel(source.id);
    }

    const task = createTask({
      projectId: source.projectId,
      prompt: `[从任务 ${source.title} 切换 agent 继续]\n\n${source.prompt}`,
      mode: agent === "codex" ? "codexOnly" : "claudeOnly",
      targetAgent: agent,
      budget: source.budget,
      permission: source.permission,
    });
    getScheduler().enqueue(task.id);
    return jsonOk({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
