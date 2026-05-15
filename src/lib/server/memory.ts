import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/server/db";
import { nowIso } from "@/lib/server/time";
import type { MemoryCategory, MemoryStatus, ProjectMemory, TaskWithRelations } from "@/lib/types";

function escapeLikePattern(s: string): string {
  return s.replace(/[%_"\\]/g, "\\$&");
}

// ─── 创建记忆 ────────────────────────────────────────────

export function createProjectMemory(input: {
  projectId: string;
  category: MemoryCategory;
  content: string;
  source: "auto" | "manual";
  status?: MemoryStatus;
  taskId?: string | null;
  tags?: string[];
}): ProjectMemory {
  const memory: ProjectMemory = {
    id: randomUUID(),
    projectId: input.projectId,
    category: input.category,
    content: input.content,
    source: input.source,
    status: input.status || (input.source === "manual" ? "confirmed" : "draft"),
    taskId: input.taskId || null,
    tags: input.tags || [],
    createdAt: nowIso(),
    confirmedAt: input.source === "manual" ? nowIso() : null,
  };

  getDb()
    .prepare(
      `INSERT INTO project_memory (id, projectId, category, content, source, status, taskId, tags, createdAt, confirmedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      memory.id,
      memory.projectId,
      memory.category,
      memory.content,
      memory.source,
      memory.status,
      memory.taskId,
      JSON.stringify(memory.tags),
      memory.createdAt,
      memory.confirmedAt,
    );

  return memory;
}

// ─── 确认草稿 ────────────────────────────────────────────

export function confirmMemory(memoryId: string): ProjectMemory | null {
  const now = nowIso();
  getDb()
    .prepare(`UPDATE project_memory SET status = 'confirmed', confirmedAt = ? WHERE id = ?`)
    .run(now, memoryId);
  return getProjectMemory(memoryId);
}

export function confirmMemories(memoryIds: string[], projectId?: string): void {
  const db = getDb();
  const sql = projectId
    ? `UPDATE project_memory SET status = 'confirmed', confirmedAt = ? WHERE id = ? AND projectId = ?`
    : `UPDATE project_memory SET status = 'confirmed', confirmedAt = ? WHERE id = ?`;
  const stmt = db.prepare(sql);
  const now = nowIso();
  const tx = db.transaction(() => {
    for (const id of memoryIds) {
      if (projectId) {
        stmt.run(now, id, projectId);
      } else {
        stmt.run(now, id);
      }
    }
  });
  tx();
}

// ─── 拒绝/删除草稿 ──────────────────────────────────────

export function rejectMemory(memoryId: string): void {
  getDb().prepare(`DELETE FROM project_memory WHERE id = ?`).run(memoryId);
}

// ─── 单条查询 ────────────────────────────────────────────

export function getProjectMemory(memoryId: string): ProjectMemory | null {
  const row = getDb().prepare("SELECT * FROM project_memory WHERE id = ?").get(memoryId) as
    | (Omit<ProjectMemory, "tags"> & { tags: string })
    | undefined;
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags || "[]") };
}

// ─── 检索已确认记忆 ──────────────────────────────────────

export function searchProjectMemory(
  projectId: string,
  options: {
    query?: string;
    categories?: MemoryCategory[];
    limit?: number;
    tags?: string[];
    status?: MemoryStatus;
  } = {}
): ProjectMemory[] {
  const { categories, limit = 10, tags, status = "confirmed" } = options;
  let sql = "SELECT * FROM project_memory WHERE projectId = ? AND status = ?";
  const params: unknown[] = [projectId, status];

  if (categories?.length) {
    sql += ` AND category IN (${categories.map(() => "?").join(",")})`;
    params.push(...categories);
  }

  if (tags?.length) {
    for (const tag of tags) {
      sql += ` AND tags LIKE ? ESCAPE '\\'`;
      params.push(`%"${escapeLikePattern(tag)}"%`);
    }
  }

  sql += " ORDER BY createdAt DESC LIMIT ?";
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params) as Array<Omit<ProjectMemory, "tags"> & { tags: string }>;
  return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags || "[]") }));
}

// ─── 获取待确认草稿 ──────────────────────────────────────

export function getPendingMemories(projectId: string): ProjectMemory[] {
  const rows = getDb()
    .prepare(`SELECT * FROM project_memory WHERE projectId = ? AND status = 'draft' ORDER BY createdAt DESC`)
    .all(projectId) as Array<Omit<ProjectMemory, "tags"> & { tags: string }>;
  return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags || "[]") }));
}

// ─── 任务完成后自动提取记忆 ──────────────────────────────

/**
 * 从已完成任务中自动提取草稿记忆
 * 规则：使用正则匹配多个模式，至少匹配 2 个模式才提取
 * 提取的记忆为 draft 状态，需用户确认后才进入上下文包
 */
export function extractMemoryFromTask(task: TaskWithRelations): ProjectMemory[] {
  const memories: ProjectMemory[] = [];
  const summary = task.summary || "";
  if (!summary.trim()) return memories;

  const matchedCategories: MemoryCategory[] = [];

  // 架构相关
  if (/架构|技术选型|设计模式|系统设计|模块划分/.test(summary)) {
    matchedCategories.push("architecture");
  }

  // 决策相关
  if (/决定|选型|方案|trade-off|权衡|采用/.test(summary)) {
    matchedCategories.push("decision");
  }

  // 代码规范相关
  if (/规范|约定|风格|lint|格式|命名/.test(summary)) {
    matchedCategories.push("convention");
  }

  // 问题/踩坑记录
  if (/问题|bug|风险|缺陷|修复|踩坑|注意|坑/.test(summary)) {
    matchedCategories.push("issue");
  }

  // 上下文信息
  if (/依赖|版本|环境|配置|兼容/.test(summary)) {
    matchedCategories.push("context");
  }

  // 只有匹配 2 个以上类别才提取，避免误判
  if (matchedCategories.length >= 2) {
    const primaryCategory = matchedCategories[0];
    memories.push(
      createProjectMemory({
        projectId: task.projectId,
        category: primaryCategory,
        content: summary.slice(0, 2000),
        source: "auto",
        status: "draft",
        taskId: task.id,
        tags: matchedCategories,
      })
    );
  }

  return memories;
}
