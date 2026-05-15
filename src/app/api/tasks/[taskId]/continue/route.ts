import { buildContextPackage, saveContextSnapshot } from "@/lib/server/context";
import { createTask, getTask } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";
import { continueTaskSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const body = await request.text();
    let input: ReturnType<typeof continueTaskSchema.parse>;
    if (!body) {
      input = { action: "wait" as const };
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return jsonError(new Error("请求体不是有效 JSON"), 400);
      }
      input = continueTaskSchema.parse(parsed);
    }

    if (input.action === "wait") {
      getScheduler().continue(taskId);
      return jsonOk({ ok: true });
    }

    const source = getTask(taskId);
    if (!source) throw new Error("任务不存在");

    const contextPackage = buildContextPackage(taskId, {
      includeMessages: input.includeMessages,
      extraInstruction: input.prompt,
    });
    saveContextSnapshot(taskId, null, contextPackage);

    const task = createTask({
      projectId: source.projectId,
      parentTaskId: source.id,
      prompt: [
        `[基于任务继续：${source.title}]`,
        "",
        "## 用户补充指令",
        input.prompt,
      ].join("\n"),
      mode: input.mode,
      targetAgent: input.targetAgent || null,
      budget: input.budget,
      permission: input.permission,
      memoryMode: source.memoryMode,
      contextPolicy: contextPackage.policy,
    });

    getScheduler().enqueue(task.id);
    return jsonOk({ task, context: contextPackage }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
