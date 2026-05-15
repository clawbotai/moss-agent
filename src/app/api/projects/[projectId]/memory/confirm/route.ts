import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/db";
import { confirmMemories } from "@/lib/server/memory";

type RouteContext = { params: Promise<{ projectId: string }> };

// POST /api/projects/:projectId/memory/confirm — 批量确认草稿
export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const body = await request.json();
  const { memoryIds } = body as { memoryIds: string[] };

  if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
    return NextResponse.json({ error: "缺少 memoryIds" }, { status: 400 });
  }

  confirmMemories(memoryIds, projectId);
  return NextResponse.json({ confirmed: memoryIds.length });
}
