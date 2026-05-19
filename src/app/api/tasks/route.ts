import { createTask, listTasks } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { getScheduler } from "@/lib/server/scheduler";
import { validateSkillSelection } from "@/lib/server/skills";
import { createTaskSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") || undefined;
    return jsonOk({ tasks: listTasks(projectId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createTaskSchema.parse(await request.json());
    if (input.skillSelection) {
      const validation = validateSkillSelection(input.skillSelection, input.mode);
      if (!validation.ok) {
        return jsonError(new Error(validation.errors.join("; ")), 400);
      }
    }
    const task = createTask(input);
    getScheduler().enqueue(task.id);
    return jsonOk({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
