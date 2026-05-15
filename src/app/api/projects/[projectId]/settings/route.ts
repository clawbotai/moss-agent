import { getProjectSettings, upsertProjectSettings } from "@/lib/server/db";
import { jsonError, jsonOk } from "@/lib/server/http";
import { projectSettingsSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const settings = getProjectSettings(projectId);
    return jsonOk({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器错误";
    const status = message === "项目不存在" ? 404 : 500;
    return jsonError(error, status);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(new Error("请求体不是有效 JSON"), 400);
    }

    const body = projectSettingsSchema.parse(payload);
    const settings = upsertProjectSettings(projectId, body);
    return jsonOk({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器错误";
    const status = message === "项目不存在" ? 404 : 500;
    return jsonError(error, status);
  }
}
