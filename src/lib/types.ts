export type AgentId = "claude" | "codex" | "custom";

export type TaskMode = "collaborative" | "codexOnly" | "claudeOnly" | "custom";

export type BudgetLevel = "low" | "standard" | "high";

export type PermissionLevel = "readOnly" | "workspaceWrite" | "fullAccess";

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
  title: string;
  prompt: string;
  mode: TaskMode;
  targetAgent: AgentId | null;
  budget: BudgetLevel;
  permission: PermissionLevel;
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
}

export interface CreateTaskInput {
  projectId: string;
  prompt: string;
  mode: TaskMode;
  targetAgent?: AgentId | null;
  budget: BudgetLevel;
  permission: PermissionLevel;
}

export interface CreateProjectInput {
  name?: string;
  path: string;
}
