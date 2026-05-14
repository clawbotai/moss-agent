import type { AgentDiagnostic, AgentId, BudgetLevel, PermissionLevel } from "@/lib/types";

export interface AgentRunContext {
  taskId: string;
  stageId: string;
  projectPath: string;
  prompt: string;
  budget: BudgetLevel;
  permission: PermissionLevel;
  signal: AbortSignal;
  onLog: (message: string, payload?: unknown) => void;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  exitCode: number | null;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  detect(): Promise<AgentDiagnostic>;
  run(context: AgentRunContext): Promise<AgentRunResult>;
  review(context: AgentRunContext): Promise<AgentRunResult>;
}
