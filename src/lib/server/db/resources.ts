import { randomUUID } from "node:crypto";
import type {
  AgentId,
  AgentMessage,
  AgentMessageIntent,
  AgentRun,
  Artifact,
  ArtifactType,
  MemoryMode,
  TaskContextSnapshot,
  TaskMessage,
  TaskMessageRole,
  TaskSkillSelection,
} from "@/lib/types";
import { EMPTY_SKILL_SELECTION } from "@/lib/types";
import { nowIso } from "@/lib/server/time";
import { getDb } from "./init";
import type { DbContextSnapshotRow, DbMessageRow } from "./init";
import { serializeSkillSelection } from "./skill-selection";

// ─── Task Messages ───────────────────────────────────────

export function createTaskMessage(input: {
  taskId: string;
  role: TaskMessageRole;
  content: string;
  includeInContext?: boolean;
  skillSelection?: TaskSkillSelection;
}): TaskMessage {
  // 直接查询 contextPolicy 而非调用 getTask()，避免与 tasks.ts 形成循环依赖
  const task = getDb()
    .prepare("SELECT contextPolicy FROM tasks WHERE id = ?")
    .get(input.taskId) as { contextPolicy: string } | undefined;
  if (!task) throw new Error("任务不存在");
  const now = nowIso();
  const message: TaskMessage = {
    id: randomUUID(),
    taskId: input.taskId,
    role: input.role,
    content: input.content.trim(),
    includeInContext: Boolean(input.includeInContext),
    skillSelectionJson: serializeSkillSelection(input.skillSelection ?? EMPTY_SKILL_SELECTION),
    createdAt: now,
  };

  getDb()
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
      message.includeInContext ? 1 : 0,
      message.skillSelectionJson,
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

// ─── Context Snapshots ───────────────────────────────────

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

/**
 * 获取指定 stage 的最近 agent_run 摘要（用于恢复上下文）
 */
export function getLatestAgentRunForStage(stageId: string): AgentRun | null {
  return (
    (getDb()
      .prepare("SELECT * FROM agent_runs WHERE stageId = ? ORDER BY startedAt DESC LIMIT 1")
      .get(stageId) as AgentRun | undefined) || null
  );
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
