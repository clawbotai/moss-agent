import { jsonError, jsonOk } from "@/lib/server/http";
import { ConfirmError, getScheduler } from "@/lib/server/scheduler";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> };

const confirmSchema = z.object({
  response: z.string().trim().min(1, "确认回复不能为空").max(4000, "确认回复不能超过 4000 字"),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const body = await request.json();
    const parsed = confirmSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(new Error(parsed.error.errors[0].message), 400);
    }

    getScheduler().confirmAndContinue(taskId, parsed.data.response);
    return jsonOk({ ok: true });
  } catch (error) {
    if (error instanceof ConfirmError) {
      return jsonError(new Error(error.message), error.status);
    }
    const message = error instanceof Error ? error.message : "确认请求处理失败";
    return jsonError(new Error(message), 500);
  }
}
