import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentId,
  AgentMessage,
  AgentMessageIntent,
  AgentRun,
  Artifact,
  ArtifactType,
  BudgetLevel,
  CreateProjectInput,
  CreateTaskInput,
  DeriveOptions,
  LogLevel,
  MemoryCategory,
  MemoryMode,
  MemoryStatus,
  PermissionLevel,
  Project,
  ProjectMemory,
  ProjectSettings,
  StageStatus,
  Task,
  TaskContextSnapshot,
  TaskLog,
  TaskMessage,
  TaskMessageRole,
  TaskMode,
  TaskStage,
  TaskStatus,
  TaskWithRelations,
} from "@/lib/types";
import { DERIVE_OPTIONS_DEFAULTS } from "@/lib/types";
import { nowIso, shortTitle } from "@/lib/server/time";

type DbTaskRow = Omit<Task, "targetAgent"> & { targetAgent: AgentId | null };
type DbStageRow = TaskStage;
type DbLogRow = Omit<TaskLog, "payload"> & { payloadJson: string | null };
type DbMessageRow = Omit<TaskMessage, "includeInContext"> & { includeInContext: number };
type DbContextSnapshotRow = TaskContextSnapshot;

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
      parentTaskId TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      targetAgent TEXT,
      budget TEXT NOT NULL,
      permission TEXT NOT NULL,
      memoryMode TEXT NOT NULL DEFAULT 'taskSummary',
      contextPolicy TEXT NOT NULL DEFAULT 'taskSummary',
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

export function createTask(input: CreateTaskInput): Task {
  const project = getProject(input.projectId);
  if (!project) throw new Error("项目不存在");

  const now = nowIso();
  const task: Task = {
    id: randomUUID(),
    projectId: input.projectId,
    parentTaskId: input.parentTaskId || null,
    title: shortTitle(input.prompt),
    prompt: input.prompt.trim(),
    mode: input.mode,
    targetAgent: input.targetAgent || null,
    budget: input.budget,
    permission: input.permission,
    memoryMode: input.memoryMode || "auto",
    contextPolicy: input.contextPolicy || "auto",
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
        id, projectId, parentTaskId, title, prompt, mode, targetAgent, budget, permission,
        memoryMode, contextPolicy,
        status, currentStage, summary, errorMessage, createdAt, updatedAt,
        startedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.projectId,
      task.parentTaskId,
      task.title,
      task.prompt,
      task.mode,
      task.targetAgent,
      task.budget,
      task.permission,
      task.memoryMode,
      task.contextPolicy,
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
    messages: listTaskMessages(taskId),
    contextSnapshots: listContextSnapshots(taskId, 12),
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

export function createTaskMessage(input: {
  taskId: string;
  role: TaskMessageRole;
  content: string;
  includeInContext?: boolean;
}): TaskMessage {
  const task = getTask(input.taskId);
  if (!task) throw new Error("任务不存在");
  const now = nowIso();
  const message: TaskMessage = {
    id: randomUUID(),
    taskId: input.taskId,
    role: input.role,
    content: input.content.trim(),
    includeInContext: Boolean(input.includeInContext),
    createdAt: now,
  };

  getDb()
    .prepare(
      `INSERT INTO task_messages (
        id, taskId, role, content, includeInContext, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.id,
      message.taskId,
      message.role,
      message.content,
      message.includeInContext ? 1 : 0,
      message.createdAt,
    );

  getDb()
    .prepare("UPDATE tasks SET updatedAt = ?, contextPolicy = ? WHERE id = ?")
    .run(
      now,
      input.includeInContext && !task.contextPolicy.includes("selectedMessages")
        ? `${task.contextPolicy}+selectedMessages`
        : task.contextPolicy,
      input.taskId,
    );

  return message;
}

export function listTaskMessages(taskId: string, limit = 100): TaskMessage[] {
  const rows = getDb()
    .prepare("SELECT * FROM task_messages WHERE taskId = ? ORDER BY createdAt ASC LIMIT ?")
    .all(taskId, limit) as DbMessageRow[];

  return rows.map((row) => ({
    ...row,
    includeInContext: Boolean(row.includeInContext),
  }));
}

export function createContextSnapshot(input: {
  taskId: string;
  stageId?: string | null;
  policy: string;
  memoryMode: MemoryMode;
  content: string;
  tokenEstimate: number;
}): TaskContextSnapshot {
  const snapshot: TaskContextSnapshot = {
    id: randomUUID(),
    taskId: input.taskId,
    stageId: input.stageId || null,
    policy: input.policy,
    memoryMode: input.memoryMode,
    content: input.content,
    tokenEstimate: input.tokenEstimate,
    createdAt: nowIso(),
  };

  getDb()
    .prepare(
      `INSERT INTO task_context_snapshots (
        id, taskId, stageId, policy, memoryMode, content, tokenEstimate, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshot.id,
      snapshot.taskId,
      snapshot.stageId,
      snapshot.policy,
      snapshot.memoryMode,
      snapshot.content,
      snapshot.tokenEstimate,
      snapshot.createdAt,
    );

  return snapshot;
}

export function listContextSnapshots(taskId: string, limit = 20): TaskContextSnapshot[] {
  return getDb()
    .prepare("SELECT * FROM task_context_snapshots WHERE taskId = ? ORDER BY createdAt DESC LIMIT ?")
    .all(taskId, limit) as DbContextSnapshotRow[];
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

// ─── Artifact CRUD ───────────────────────────────────────

export function createArtifact(input: {
  taskId: string;
  stageId?: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  filePath?: string | null;
  metadataJson?: string | null;
}): Artifact {
  const artifact: Artifact = {
    id: randomUUID(),
    taskId: input.taskId,
    stageId: input.stageId || null,
    type: input.type,
    title: input.title,
    content: input.content,
    filePath: input.filePath || null,
    metadataJson: input.metadataJson || null,
    createdAt: nowIso(),
  };

  getDb()
    .prepare(
      `INSERT INTO artifacts (id, taskId, stageId, type, title, content, filePath, metadataJson, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(artifact.id, artifact.taskId, artifact.stageId, artifact.type, artifact.title, artifact.content, artifact.filePath, artifact.metadataJson, artifact.createdAt);

  return artifact;
}

export function listArtifacts(taskId: string): Artifact[] {
  return getDb()
    .prepare("SELECT * FROM artifacts WHERE taskId = ? ORDER BY createdAt ASC")
    .all(taskId) as Artifact[];
}

// ─── Agent Run CRUD ──────────────────────────────────────

export function createAgentRun(input: {
  taskId: string;
  stageId: string;
  agent: AgentId;
  command: string;
}): AgentRun {
  const run: AgentRun = {
    id: randomUUID(),
    taskId: input.taskId,
    stageId: input.stageId,
    agent: input.agent,
    command: input.command,
    startedAt: nowIso(),
    completedAt: null,
    exitCode: null,
    tokenEstimate: null,
    errorMessage: null,
  };

  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, taskId, stageId, agent, command, startedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(run.id, run.taskId, run.stageId, run.agent, run.command, run.startedAt);

  return run;
}

export function completeAgentRun(runId: string, updates: { exitCode?: number | null; tokenEstimate?: number | null; errorMessage?: string | null }) {
  getDb()
    .prepare(
      `UPDATE agent_runs SET completedAt = ?, exitCode = ?, tokenEstimate = ?, errorMessage = ? WHERE id = ?`
    )
    .run(nowIso(), updates.exitCode ?? null, updates.tokenEstimate ?? null, updates.errorMessage ?? null, runId);
}

export function listAgentRuns(taskId: string): AgentRun[] {
  return getDb()
    .prepare("SELECT * FROM agent_runs WHERE taskId = ? ORDER BY startedAt ASC")
    .all(taskId) as AgentRun[];
}

// ─── Agent Message CRUD ──────────────────────────────────

export function createAgentMessage(input: {
  taskId: string;
  stageId?: string | null;
  fromAgent: string;
  toAgent: string;
  intent: AgentMessageIntent;
  content: string;
  artifactId?: string | null;
}): AgentMessage {
  const message: AgentMessage = {
    id: randomUUID(),
    taskId: input.taskId,
    stageId: input.stageId || null,
    fromAgent: input.fromAgent as AgentMessage["fromAgent"],
    toAgent: input.toAgent as AgentMessage["toAgent"],
    intent: input.intent,
    content: input.content,
    artifactId: input.artifactId || null,
    createdAt: nowIso(),
  };

  getDb()
    .prepare(
      `INSERT INTO agent_messages (id, taskId, stageId, fromAgent, toAgent, intent, content, artifactId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(message.id, message.taskId, message.stageId, message.fromAgent, message.toAgent, message.intent, message.content, message.artifactId, message.createdAt);

  return message;
}

export function listAgentMessages(taskId: string): AgentMessage[] {
  return getDb()
    .prepare("SELECT * FROM agent_messages WHERE taskId = ? ORDER BY createdAt ASC")
    .all(taskId) as AgentMessage[];
}

export function getParentTaskId(taskId: string): string | null {
  const row = getDb().prepare("SELECT parentTaskId FROM tasks WHERE id = ?").get(taskId) as
    | { parentTaskId: string | null }
    | undefined;
  return row?.parentTaskId ?? null;
}

export function getTaskDeriveOptions(taskId: string): DeriveOptions {
  const row = getDb().prepare("SELECT deriveOptionsJson FROM tasks WHERE id = ?").get(taskId) as
    | { deriveOptionsJson: string | null }
    | undefined;
  if (!row?.deriveOptionsJson) return DERIVE_OPTIONS_DEFAULTS;
  try {
    return { ...DERIVE_OPTIONS_DEFAULTS, ...JSON.parse(row.deriveOptionsJson) };
  } catch {
    return DERIVE_OPTIONS_DEFAULTS;
  }
}

export const enumValues = {
  taskModes: ["collaborative", "codexOnly", "claudeOnly", "custom"] satisfies TaskMode[],
  budgets: ["low", "standard", "high"] satisfies BudgetLevel[],
  permissions: ["readOnly", "workspaceWrite", "fullAccess"] satisfies PermissionLevel[],
};
