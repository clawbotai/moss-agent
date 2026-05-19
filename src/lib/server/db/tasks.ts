import { randomUUID } from "node:crypto";
import type {
  BudgetLevel,
  CreateTaskInput,
  DeriveOptions,
  PermissionLevel,
  Task,
  TaskMessage,
  TaskMode,
  TaskStatus,
  TaskWithRelations,
} from "@/lib/types";
import { DERIVE_OPTIONS_DEFAULTS, EMPTY_SKILL_SELECTION } from "@/lib/types";
import { nowIso, shortTitle } from "@/lib/server/time";
import { getDb, VALID_TASK_TRANSITIONS } from "./init";
import type { DbTaskRow } from "./init";
import { getProject, touchProject } from "./projects";
import { listStages, listLogs } from "./stages-logs";
import { listTaskMessages, listContextSnapshots } from "./resources";
import { parseSkillSelection, serializeSkillSelection } from "./skill-selection";

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
    pendingMode: null,
    skillSelectionJson: serializeSkillSelection(input.skillSelection ?? EMPTY_SKILL_SELECTION),
    pendingSkillSelectionJson: null,
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
        memoryMode, contextPolicy, skillSelectionJson, pendingSkillSelectionJson,
        status, currentStage, summary, errorMessage, createdAt, updatedAt,
        startedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      task.skillSelectionJson,
      task.pendingSkillSelectionJson,
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
    skillSelection: parseSkillSelection(task.skillSelectionJson),
  };
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  updates: Partial<Pick<Task, "currentStage" | "summary" | "errorMessage" | "startedAt" | "completedAt">> = {},
) {
  const current = getTask(taskId);
  if (!current) return;

  // 状态转换校验（允许相同状态的幂等更新）
  if (current.status !== status) {
    const allowed = VALID_TASK_TRANSITIONS[current.status];
    if (!allowed?.has(status)) {
      // TODO: 观察一段时间后，如果没有误报，改为 throw
      console.warn(`[MOSS] 非法状态转换: ${current.status} -> ${status} (task: ${taskId})`);
    }
  }

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

export function setPendingMode(taskId: string, mode: TaskMode | null) {
  getDb()
    .prepare("UPDATE tasks SET pendingMode = ?, updatedAt = ? WHERE id = ?")
    .run(mode, nowIso(), taskId);
}

export function applyTaskMode(taskId: string, mode: TaskMode) {
  getDb()
    .prepare("UPDATE tasks SET pendingMode = NULL, mode = ?, updatedAt = ? WHERE id = ?")
    .run(mode, nowIso(), taskId);
}

export function applyTaskModeAndSkills(
  taskId: string,
  mode: TaskMode,
  skillSelectionJson: string | null,
) {
  getDb()
    .prepare(
      `UPDATE tasks SET
        pendingMode = NULL,
        mode = ?,
        pendingSkillSelectionJson = NULL,
        skillSelectionJson = ?,
        updatedAt = ?
      WHERE id = ?`,
    )
    .run(mode, skillSelectionJson, nowIso(), taskId);
}

/**
 * 原子性地记录确认回复，并将任务从 waiting 转为 running。
 * 防止并发确认请求和部分写入导致的状态不一致。
 */
export function confirmTaskWithMessage(input: {
  taskId: string;
  content: string;
}): TaskMessage | null {
  const database = getDb();
  const transaction = database.transaction(() => {
    const now = nowIso();
    const updateResult = database
      .prepare("UPDATE tasks SET status = 'running', errorMessage = NULL, updatedAt = ? WHERE id = ? AND status = 'waiting'")
      .run(now, input.taskId);

    if (updateResult.changes === 0) return null;

    const task = getTask(input.taskId);
    if (!task) return null;

    const message: import("@/lib/types").TaskMessage = {
      id: randomUUID(),
      taskId: input.taskId,
      role: "user",
      content: input.content.trim(),
      includeInContext: true,
      skillSelectionJson: null,
      createdAt: now,
    };

    database
      .prepare(
        `INSERT INTO task_messages (
          id, taskId, role, content, includeInContext, skillSelectionJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.taskId,
        message.role,
        message.content,
        1,
        message.skillSelectionJson,
        message.createdAt,
      );

    database
      .prepare("UPDATE tasks SET updatedAt = ?, contextPolicy = ? WHERE id = ?")
      .run(
        now,
        task.contextPolicy.includes("selectedMessages")
          ? task.contextPolicy
          : `${task.contextPolicy}+selectedMessages`,
        input.taskId,
      );

    return message;
  });

  return transaction();
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

export function getRecoverableTasks(): Task[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE status IN ('running', 'stuck')")
    .all() as Task[];
}

export const enumValues = {
  taskModes: ["collaborative", "codexOnly", "claudeOnly", "custom"] satisfies TaskMode[],
  budgets: ["low", "standard", "high"] satisfies BudgetLevel[],
  permissions: ["readOnly", "workspaceWrite", "fullAccess"] satisfies PermissionLevel[],
};
