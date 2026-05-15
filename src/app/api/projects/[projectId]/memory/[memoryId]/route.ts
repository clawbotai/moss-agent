import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/db";
import { getProjectMemory, rejectMemory } from "@/lib/server/memory";

type RouteContext = { params: Promise<{ projectId: string; memoryId: string }> };

// DELETE /api/projects/:projectId/memory/:memoryId — 删除记忆
export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId, memoryId } = await context.params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const memory = getProjectMemory(memoryId);
  if (!memory) {
    return NextResponse.json({ error: "记忆不存在" }, { status: 404 });
  }

  if (memory.projectId !== projectId) {
    return NextResponse.json({ error: "记忆不属于该项目" }, { status: 403 });
  }

  rejectMemory(memoryId);
  return NextResponse.json({ deleted: true });
}
