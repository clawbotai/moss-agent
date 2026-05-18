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
  /** 单次 attempt 超时时间（毫秒） */
  timeoutMs?: number;
  /** 当前 attempt 序号（从 1 开始），默认为 1 */
  attempt?: number;
  /** 恢复提示：包含上次终止原因、历史输出摘要、工作区状态等 */
  resumeHint?: string;
}

export interface AgentConfirmationRequest {
  /** 确认问题的描述 */
  question: string;
  /** 可选的选项列表（如果为空则为自由文本输入） */
  options?: string[];
  /** 默认选项索引 */
  defaultOption?: number;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  exitCode: number | null;
  /** 是否因超时被终止 */
  timedOut?: boolean;
  /** 是否因用户取消被终止 */
  aborted?: boolean;
  /** 进程退出信号 */
  signal?: NodeJS.Signals | null;
  /** Agent 请求用户确认（暂停执行等待用户回复） */
  confirmationRequest?: AgentConfirmationRequest;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  detect(): Promise<AgentDiagnostic>;
  run(context: AgentRunContext): Promise<AgentRunResult>;
  review(context: AgentRunContext): Promise<AgentRunResult>;
}
