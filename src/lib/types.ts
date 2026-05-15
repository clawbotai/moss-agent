export type AgentId = "claude" | "codex" | "custom";

export type TaskMode = "collaborative" | "codexOnly" | "claudeOnly" | "custom";

export type BudgetLevel = "low" | "standard" | "high";

export type PermissionLevel = "readOnly" | "workspaceWrite" | "fullAccess";

export type MemoryMode = "off" | "taskSummary" | "projectMemory";

export type TaskMessageRole = "user" | "system" | "agent";

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "stuck"
  | "failed"
  | "cancelled"
  | "completed";

export type StageStatus =
  | "queued"
  | "running"
  | "skipped"
  | "failed"
  | "cancelled"
  | "completed";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  title: string;
  prompt: string;
  mode: TaskMode;
  targetAgent: AgentId | null;
  budget: BudgetLevel;
  permission: PermissionLevel;
  memoryMode: MemoryMode;
  contextPolicy: string;
  status: TaskStatus;
  currentStage: string | null;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskStage {
  id: string;
  taskId: string;
  name: string;
  agent: AgentId;
  role: "plan" | "review" | "revise" | "implement" | "audit" | "summarize";
  status: StageStatus;
  inputSummary: string | null;
  outputSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  orderIndex: number;
}

export interface TaskLog {
  id: number;
  taskId: string;
  stageId: string | null;
  level: LogLevel;
  message: string;
  payload: unknown;
  createdAt: string;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  role: TaskMessageRole;
  content: string;
  includeInContext: boolean;
  createdAt: string;
}

export interface TaskContextSnapshot {
  id: string;
  taskId: string;
  stageId: string | null;
  policy: string;
  memoryMode: MemoryMode;
  content: string;
  tokenEstimate: number;
  createdAt: string;
}

export interface AgentDiagnostic {
  id: AgentId;
  label: string;
  available: boolean;
  command: string;
  version: string | null;
  message: string;
}

export interface TaskWithRelations extends Task {
  project: Project | null;
  stages: TaskStage[];
  logs: TaskLog[];
  messages: TaskMessage[];
  contextSnapshots: TaskContextSnapshot[];
}

export interface CreateTaskInput {
  projectId: string;
  parentTaskId?: string | null;
  prompt: string;
  mode: TaskMode;
  targetAgent?: AgentId | null;
  budget: BudgetLevel;
  permission: PermissionLevel;
  memoryMode?: MemoryMode;
  contextPolicy?: string;
}

export interface CreateProjectInput {
  name?: string;
  path: string;
}

// ─── Artifact ────────────────────────────────────────────

export type ArtifactType = "plan" | "review" | "diff" | "test" | "summary" | "handoff" | "report";

export interface Artifact {
  id: string;
  taskId: string;
  stageId: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  filePath: string | null;
  metadataJson: string | null;
  createdAt: string;
}

// ─── Agent Messages ──────────────────────────────────────

export type AgentMessageIntent = "clarification" | "review_comment" | "blocked" | "status_update" | "fix_request";

export interface AgentMessage {
  id: string;
  taskId: string;
  stageId: string | null;
  fromAgent: AgentId | "system";
  toAgent: AgentId | "system" | "user";
  intent: AgentMessageIntent;
  content: string;
  artifactId: string | null;
  createdAt: string;
}

// ─── Agent Runs ──────────────────────────────────────────

export interface AgentRun {
  id: string;
  taskId: string;
  stageId: string;
  agent: AgentId;
  command: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  tokenEstimate: number | null;
  errorMessage: string | null;
}

// ─── Project Memory ──────────────────────────────────────

export type MemoryCategory = "architecture" | "decision" | "convention" | "issue" | "context";
export type MemoryStatus = "draft" | "confirmed";

export interface ProjectMemory {
  id: string;
  projectId: string;
  category: MemoryCategory;
  content: string;
  source: "auto" | "manual";
  status: MemoryStatus;
  taskId: string | null;
  tags: string[];
  createdAt: string;
  confirmedAt: string | null;
}

// ─── Derive Options ─────────────────────────────────────

export interface DeriveOptions {
  inheritStages: "completed" | "lastN" | number;
  inheritMessages: boolean;
  contextScope: "minimal" | "standard" | "full";
  includeParentSummary: boolean;
}

export const DERIVE_OPTIONS_DEFAULTS: DeriveOptions = {
  inheritStages: "completed",
  inheritMessages: false,
  contextScope: "standard",
  includeParentSummary: true,
};

// ─── Stage Role ─────────────────────────────────────────

export type StageRole = "plan" | "review" | "revise" | "implement" | "audit" | "summarize";
