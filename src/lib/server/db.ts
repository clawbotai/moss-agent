import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentId,
  BudgetLevel,
  CreateProjectInput,
  CreateTaskInput,
  LogLevel,
  PermissionLevel,
  Project,
  StageStatus,
  Task,
  TaskLog,
  TaskMode,
  TaskStage,
  TaskStatus,
  TaskWithRelations,
} from "@/lib/types";
import { nowIso, shortTitle } from "@/lib/server/time";

type DbTaskRow = Omit<Task, "targetAgent"> & { targetAgent: AgentId | null };
type DbStageRow = TaskStage;
type DbLogRow = Omit<TaskLog, "payload"> & { payloadJson: string | null };

let db: Database.Database | null = null;

function getDataDir() {
  return process.env.MOSS_DATA_DIR || path.join(process.cwd(), ".moss-agent");
}

function getDbPath() {
  return path.join(getDataDir(), "moss-agent.sqlite");
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(getDataDir(), { recursive: true });
    db = new Database(getDbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      targetAgent TEXT,
      budget TEXT NOT NULL,
      permission TEXT NOT NULL,
      status TEXT NOT NULL,
      currentStage TEXT,
      summary TEXT,
      errorMessage TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stages (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      name TEXT NOT NULL,
      agent TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      inputSummary TEXT,
      outputSummary TEXT,
      startedAt TEXT,
      completedAt TEXT,
      errorMessage TEXT,
      orderIndex INTEGER NOT NULL,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId TEXT NOT NULL,
      stageId TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      payloadJson TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(stageId) REFERENCES stages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(projectId, status, createdAt);
    CREATE INDEX IF NOT EXISTS idx_stages_task_order ON stages(taskId, orderIndex);
    CREATE INDEX IF NOT EXISTS idx_logs_task_created ON logs(taskId, createdAt, id);
  `);
}

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

export function createTask(input: CreateTaskInput): Task {
  const project = getProject(input.projectId);
  if (!project) throw new Error("项目不存在");

  const now = nowIso();
  const task: Task = {
    id: randomUUID(),
    projectId: input.projectId,
    title: shortTitle(input.prompt),
    prompt: input.prompt.trim(),
    mode: input.mode,
    targetAgent: input.targetAgent || null,
    budget: input.budget,
    permission: input.permission,
    status: "queued",
    currentStage: null,
    summary: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };

  getDb()
    .prepare(
      `INSERT INTO tasks (
        id, projectId, title, prompt, mode, targetAgent, budget, permission,
        status, currentStage, summary, errorMessage, createdAt, updatedAt,
        startedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.projectId,
      task.title,
      task.prompt,
      task.mode,
      task.targetAgent,
      task.budget,
      task.permission,
      task.status,
      task.currentStage,
      task.summary,
      task.errorMessage,
      task.createdAt,
      task.updatedAt,
      task.startedAt,
      task.completedAt,
    );

  touchProject(task.projectId);
  return task;
}

export function listTasks(projectId?: string): Task[] {
  const sql = projectId
    ? "SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt DESC"
    : "SELECT * FROM tasks ORDER BY createdAt DESC";
  const rows = projectId
    ? getDb().prepare(sql).all(projectId)
    : getDb().prepare(sql).all();
  return rows as Task[];
}

export function getTask(taskId: string): Task | null {
  return (
    (getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as DbTaskRow | undefined) ||
    null
  );
}

export function getTaskWithRelations(taskId: string): TaskWithRelations | null {
  const task = getTask(taskId);
  if (!task) return null;

  return {
    ...task,
    project: getProject(task.projectId),
    stages: listStages(taskId),
    logs: listLogs(taskId, 300),
  };
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  updates: Partial<Pick<Task, "currentStage" | "summary" | "errorMessage" | "startedAt" | "completedAt">> = {},
) {
  const current = getTask(taskId);
  if (!current) return;
  const next = {
    currentStage: Object.hasOwn(updates, "currentStage") ? updates.currentStage ?? null : current.currentStage,
    summary: Object.hasOwn(updates, "summary") ? updates.summary ?? null : current.summary,
    errorMessage: Object.hasOwn(updates, "errorMessage")
      ? updates.errorMessage ?? null
      : current.errorMessage,
    startedAt: Object.hasOwn(updates, "startedAt") ? updates.startedAt ?? null : current.startedAt,
    completedAt: Object.hasOwn(updates, "completedAt")
      ? updates.completedAt ?? null
      : current.completedAt,
  };

  getDb()
    .prepare(
      `UPDATE tasks SET
        status = ?,
        currentStage = ?,
        summary = ?,
        errorMessage = ?,
        startedAt = ?,
        completedAt = ?,
        updatedAt = ?
      WHERE id = ?`,
    )
    .run(
      status,
      next.currentStage,
      next.summary,
      next.errorMessage,
      next.startedAt,
      next.completedAt,
      nowIso(),
      taskId,
    );
}

export function createStages(taskId: string, stages: Omit<TaskStage, "id" | "taskId">[]) {
  const insert = getDb().prepare(
    `INSERT INTO stages (
      id, taskId, name, agent, role, status, inputSummary, outputSummary,
      startedAt, completedAt, errorMessage, orderIndex
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const transaction = getDb().transaction(() => {
    for (const stage of stages) {
      insert.run(
        randomUUID(),
        taskId,
        stage.name,
        stage.agent,
        stage.role,
        stage.status,
        stage.inputSummary,
        stage.outputSummary,
        stage.startedAt,
        stage.completedAt,
        stage.errorMessage,
        stage.orderIndex,
      );
    }
  });

  transaction();
}

export function listStages(taskId: string): TaskStage[] {
  return getDb()
    .prepare("SELECT * FROM stages WHERE taskId = ? ORDER BY orderIndex ASC")
    .all(taskId) as TaskStage[];
}

export function updateStage(
  stageId: string,
  updates: Partial<{
    status: StageStatus;
    inputSummary: string | null;
    outputSummary: string | null;
    startedAt: string | null;
    completedAt: string | null;
    errorMessage: string | null;
  }>,
) {
  const current = getDb().prepare("SELECT * FROM stages WHERE id = ?").get(stageId) as
    | DbStageRow
    | undefined;
  if (!current) return;

  getDb()
    .prepare(
      `UPDATE stages SET
        status = ?,
        inputSummary = ?,
        outputSummary = ?,
        startedAt = ?,
        completedAt = ?,
        errorMessage = ?
      WHERE id = ?`,
    )
    .run(
      updates.status ?? current.status,
      updates.inputSummary ?? current.inputSummary,
      updates.outputSummary ?? current.outputSummary,
      updates.startedAt ?? current.startedAt,
      updates.completedAt ?? current.completedAt,
      updates.errorMessage ?? current.errorMessage,
      stageId,
    );
}

export function appendLog(
  taskId: string,
  level: LogLevel,
  message: string,
  options: { stageId?: string | null; payload?: unknown } = {},
) {
  const result = getDb()
    .prepare(
      "INSERT INTO logs (taskId, stageId, level, message, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      taskId,
      options.stageId ?? null,
      level,
      message,
      options.payload === undefined ? null : JSON.stringify(options.payload),
      nowIso(),
    );

  return {
    id: Number(result.lastInsertRowid),
    taskId,
    stageId: options.stageId ?? null,
    level,
    message,
    payload: options.payload ?? null,
    createdAt: nowIso(),
  } satisfies TaskLog;
}

export function listLogs(taskId: string, limit = 200): TaskLog[] {
  const rows = getDb()
    .prepare("SELECT * FROM logs WHERE taskId = ? ORDER BY id DESC LIMIT ?")
    .all(taskId, limit) as DbLogRow[];

  return rows.reverse().map((row) => ({
    id: row.id,
    taskId: row.taskId,
    stageId: row.stageId,
    level: row.level,
    message: row.message,
    payload: row.payloadJson
      ? (() => {
          try {
            return JSON.parse(row.payloadJson);
          } catch {
            return null;
          }
        })()
      : null,
    createdAt: row.createdAt,
  }));
}

export function resetTaskForRetry(taskId: string) {
  const transaction = getDb().transaction(() => {
    getDb()
      .prepare("DELETE FROM stages WHERE taskId = ?")
      .run(taskId);
    getDb()
      .prepare(
        `UPDATE tasks SET
          status = 'queued',
          currentStage = NULL,
          summary = NULL,
          errorMessage = NULL,
          startedAt = NULL,
          completedAt = NULL,
          updatedAt = ?
        WHERE id = ?`,
      )
      .run(nowIso(), taskId);
  });
  transaction();
}

function touchProject(projectId: string) {
  getDb().prepare("UPDATE projects SET updatedAt = ? WHERE id = ?").run(nowIso(), projectId);
}

export const enumValues = {
  taskModes: ["collaborative", "codexOnly", "claudeOnly", "custom"] satisfies TaskMode[],
  budgets: ["low", "standard", "high"] satisfies BudgetLevel[],
  permissions: ["readOnly", "workspaceWrite", "fullAccess"] satisfies PermissionLevel[],
};
