import { randomUUID } from "node:crypto";
import type { LogLevel, StageStatus, TaskLog, TaskStage } from "@/lib/types";
import { nowIso } from "@/lib/server/time";
import { getDb, VALID_STAGE_TRANSITIONS } from "./init";
import type { DbStageRow, DbLogRow } from "./init";

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

  // 状态转换校验
  if (updates.status && updates.status !== current.status) {
    const allowed = VALID_STAGE_TRANSITIONS[current.status];
    if (!allowed?.has(updates.status)) {
      console.warn(`[MOSS] 非法阶段状态转换: ${current.status} -> ${updates.status} (stage: ${stageId})`);
    }
  }

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
