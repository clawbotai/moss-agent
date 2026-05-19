import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentId,
  StageStatus,
  Task,
  TaskContextSnapshot,
  TaskLog,
  TaskMessage,
  TaskStage,
  TaskStatus,
} from "@/lib/types";

// ─── Row type aliases ────────────────────────────────────

export type DbTaskRow = Omit<Task, "targetAgent"> & { targetAgent: AgentId | null };
export type DbStageRow = TaskStage;
export type DbLogRow = Omit<TaskLog, "payload"> & { payloadJson: string | null };
export type DbMessageRow = Omit<TaskMessage, "includeInContext"> & { includeInContext: number };
export type DbContextSnapshotRow = TaskContextSnapshot;

// ─── State transition matrices ───────────────────────────

export const VALID_TASK_TRANSITIONS: Record<TaskStatus, Set<TaskStatus>> = {
  queued: new Set(["running", "cancelled"]),
  running: new Set(["completed", "failed", "cancelled", "stuck", "waiting"]),
  stuck: new Set(["running", "failed", "cancelled"]),
  waiting: new Set(["running", "cancelled", "failed", "stuck"]), // waiting 也可以进入 stuck（超时）
  failed: new Set(["queued"]), // 只能通过 retry 回到 queued
  cancelled: new Set(["queued"]), // 只能通过 retry 回到 queued
  completed: new Set<TaskStatus>(), // 终态，不可转换
};

export const VALID_STAGE_TRANSITIONS: Record<StageStatus, Set<StageStatus>> = {
  queued: new Set(["running", "skipped", "cancelled"]),
  running: new Set(["completed", "failed", "cancelled"]),
  completed: new Set<StageStatus>(), // 终态
  failed: new Set<StageStatus>(), // 终态
  skipped: new Set<StageStatus>(), // 终态
  cancelled: new Set<StageStatus>(), // 终态
};

// ─── Database singleton ──────────────────────────────────

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

// ─── Migration ───────────────────────────────────────────

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
      parentTaskId TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      targetAgent TEXT,
      budget TEXT NOT NULL,
      permission TEXT NOT NULL,
      memoryMode TEXT NOT NULL DEFAULT 'taskSummary',
      contextPolicy TEXT NOT NULL DEFAULT 'taskSummary',
      pendingMode TEXT,
      status TEXT NOT NULL,
      currentStage TEXT,
      summary TEXT,
      errorMessage TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      startedAt TEXT,
      completedAt TEXT,
      FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(parentTaskId) REFERENCES tasks(id) ON DELETE SET NULL
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

    CREATE TABLE IF NOT EXISTS task_messages (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      includeInContext INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_context_snapshots (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT,
      policy TEXT NOT NULL,
      memoryMode TEXT NOT NULL,
      content TEXT NOT NULL,
      tokenEstimate INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(stageId) REFERENCES stages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(projectId, status, createdAt);
    CREATE INDEX IF NOT EXISTS idx_stages_task_order ON stages(taskId, orderIndex);
    CREATE INDEX IF NOT EXISTS idx_logs_task_created ON logs(taskId, createdAt, id);
    CREATE INDEX IF NOT EXISTS idx_task_messages_task_created ON task_messages(taskId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_context_snapshots_task_created ON task_context_snapshots(taskId, createdAt);
  `);

  addColumnIfMissing(database, "tasks", "parentTaskId", "TEXT");
  addColumnIfMissing(database, "tasks", "memoryMode", "TEXT NOT NULL DEFAULT 'taskSummary'");
  addColumnIfMissing(database, "tasks", "contextPolicy", "TEXT NOT NULL DEFAULT 'taskSummary'");
  addColumnIfMissing(database, "tasks", "deriveOptionsJson", "TEXT");
  addColumnIfMissing(database, "tasks", "pendingMode", "TEXT");
  addColumnIfMissing(database, "tasks", "skillSelectionJson", "TEXT");
  addColumnIfMissing(database, "tasks", "pendingSkillSelectionJson", "TEXT");
  addColumnIfMissing(database, "task_messages", "skillSelectionJson", "TEXT");

  database.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      filePath TEXT,
      metadataJson TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(stageId) REFERENCES stages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(taskId);
    CREATE INDEX IF NOT EXISTS idx_artifacts_stage ON artifacts(stageId);

    CREATE TABLE IF NOT EXISTS agent_messages (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT,
      fromAgent TEXT NOT NULL,
      toAgent TEXT NOT NULL,
      intent TEXT NOT NULL,
      content TEXT NOT NULL,
      artifactId TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(stageId) REFERENCES stages(id) ON DELETE SET NULL,
      FOREIGN KEY(artifactId) REFERENCES artifacts(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON agent_messages(taskId);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      stageId TEXT NOT NULL,
      agent TEXT NOT NULL,
      command TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      completedAt TEXT,
      exitCode INTEGER,
      tokenEstimate INTEGER,
      errorMessage TEXT,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY(stageId) REFERENCES stages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(taskId);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_stage ON agent_runs(stageId);

    CREATE TABLE IF NOT EXISTS project_memory (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      taskId TEXT,
      tags TEXT,
      createdAt TEXT NOT NULL,
      confirmedAt TEXT,
      FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_project_category ON project_memory(projectId, category);
    CREATE INDEX IF NOT EXISTS idx_memory_project_status ON project_memory(projectId, status);

    CREATE TABLE IF NOT EXISTS project_settings (
      projectId TEXT PRIMARY KEY,
      memoryInjectEnabled INTEGER NOT NULL DEFAULT 1,
      memoryExtractEnabled INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
}

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  if (!SAFE_IDENTIFIER.test(table) || !SAFE_IDENTIFIER.test(column)) {
    throw new Error(`无效的表名或列名: ${table}.${column}`);
  }
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
