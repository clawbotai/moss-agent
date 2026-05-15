import { NextResponse } from "next/server";
import { getProject } from "@/lib/server/db";
import {
  createProjectMemory,
  getPendingMemories,
  searchProjectMemory,
} from "@/lib/server/memory";
import type { MemoryCategory } from "@/lib/types";

type RouteContext = { params: Promise<{ projectId: string }> };

// GET /api/projects/:projectId/memory?status=draft|confirmed&category=...
export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const url = new URL(_request.url);
  const status = url.searchParams.get("status") || "confirmed";

  if (status === "draft") {
    const memories = getPendingMemories(projectId);
    return NextResponse.json({ memories });
  }

  const categoryParam = url.searchParams.get("category");
  const categories = categoryParam
    ? (categoryParam.split(",") as MemoryCategory[])
    : undefined;

  const memories = searchProjectMemory(projectId, {
    categories,
    status: "confirmed",
    limit: 50,
  });
  return NextResponse.json({ memories });
}

// POST /api/projects/:projectId/memory — 手动创建（直接 confirmed）
export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const body = await request.json();
  const { category, content, tags } = body as {
    category: MemoryCategory;
    content: string;
    tags?: string[];
  };

  if (!category || !content?.trim()) {
    return NextResponse.json({ error: "缺少 category 或 content" }, { status: 400 });
  }

  if (content.trim().length > 5000) {
    return NextResponse.json({ error: "content 不能超过 5000 字符" }, { status: 400 });
  }

  const memory = createProjectMemory({
    projectId,
    category,
    content: content.trim(),
    source: "manual",
    tags: tags || [],
  });

  return NextResponse.json({ memory }, { status: 201 });
}
