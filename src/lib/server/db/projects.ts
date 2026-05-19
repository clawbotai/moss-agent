import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CreateProjectInput, Project, ProjectSettings } from "@/lib/types";
import { nowIso } from "@/lib/server/time";
import { getDb } from "./init";

export function createProject(input: CreateProjectInput): Project {
  const absolutePath = path.resolve(input.path);

  // 安全检查：确保路径不包含危险字符或路径遍历
  const normalizedPath = path.normalize(absolutePath);
  if (normalizedPath.includes('\0') || normalizedPath !== absolutePath) {
    throw new Error("无效的项目路径");
  }

  const stats = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null;
  if (!stats || !stats.isDirectory()) {
    throw new Error("项目目录不存在或不是文件夹");
  }

  // 检查路径是否可读写
  try {
    fs.accessSync(absolutePath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new Error("项目目录权限不足，需要读写权限");
  }

  const existing = getProjectByPath(absolutePath);
  if (existing) return existing;

  const now = nowIso();
  const project: Project = {
    id: randomUUID(),
    name: input.name?.trim() || path.basename(absolutePath) || absolutePath,
    path: absolutePath,
    createdAt: now,
    updatedAt: now,
  };

  getDb()
    .prepare(
      "INSERT INTO projects (id, name, path, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    )
    .run(project.id, project.name, project.path, project.createdAt, project.updatedAt);

  return project;
}

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY updatedAt DESC")
    .all() as Project[];
}

export function getProject(projectId: string): Project | null {
  return (
    (getDb().prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined) ||
    null
  );
}

export function getProjectByPath(projectPath: string): Project | null {
  const absolutePath = path.resolve(projectPath);
  return (
    (getDb().prepare("SELECT * FROM projects WHERE path = ?").get(absolutePath) as
      | Project
      | undefined) || null
  );
}

// ─── Project Settings ───────────────────────────────────

export function getProjectSettings(projectId: string): ProjectSettings {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");

  let row = getDb()
    .prepare("SELECT * FROM project_settings WHERE projectId = ?")
    .get(projectId) as { projectId: string; memoryInjectEnabled: number; memoryExtractEnabled: number; updatedAt: string } | undefined;

  if (!row) {
    const now = nowIso();
    getDb()
      .prepare("INSERT OR IGNORE INTO project_settings (projectId, memoryInjectEnabled, memoryExtractEnabled, updatedAt) VALUES (?, 1, 1, ?)")
      .run(projectId, now);
    row = getDb()
      .prepare("SELECT * FROM project_settings WHERE projectId = ?")
      .get(projectId) as { projectId: string; memoryInjectEnabled: number; memoryExtractEnabled: number; updatedAt: string } | undefined;
    if (!row) throw new Error("项目设置初始化失败");
  }

  return {
    projectId: row.projectId,
    memoryInjectEnabled: Boolean(row.memoryInjectEnabled),
    memoryExtractEnabled: Boolean(row.memoryExtractEnabled),
    updatedAt: row.updatedAt,
  };
}

export function upsertProjectSettings(
  projectId: string,
  patch: Partial<Pick<ProjectSettings, "memoryInjectEnabled" | "memoryExtractEnabled">>,
): ProjectSettings {
  const current = getProjectSettings(projectId);
  const now = nowIso();
  const next = {
    memoryInjectEnabled: patch.memoryInjectEnabled ?? current.memoryInjectEnabled,
    memoryExtractEnabled: patch.memoryExtractEnabled ?? current.memoryExtractEnabled,
  };

  getDb()
    .prepare("UPDATE project_settings SET memoryInjectEnabled = ?, memoryExtractEnabled = ?, updatedAt = ? WHERE projectId = ?")
    .run(next.memoryInjectEnabled ? 1 : 0, next.memoryExtractEnabled ? 1 : 0, now, projectId);

  return { projectId, ...next, updatedAt: now };
}

/** @internal 仅用于 db 子模块内部跨模块调用 */
export function touchProject(projectId: string) {
  getDb().prepare("UPDATE projects SET updatedAt = ? WHERE id = ?").run(nowIso(), projectId);
}
