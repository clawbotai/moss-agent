import type { StageStatus, TaskStage } from "@/lib/types";

// 配置常量
export const STUCK_WARN_MS = Number(process.env.MOSS_STUCK_WARN_MS) || 120000; // 2 分钟警告
export const STUCK_ABORT_MS = Number(process.env.MOSS_STUCK_ABORT_MS) || 300000; // 5 分钟强制终止
export const MAX_LOG_LENGTH = 4000;
export const MAX_SUMMARY_LENGTH = 8000;
export const MAX_STAGE_SUMMARY_LENGTH = 2000;
export const TERMINAL_STAGE_STATUSES = new Set<StageStatus>([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);
export const SKIPPED_STAGE_ROLES = new Set<TaskStage["role"]>(["summarize"]);
export const RESTART_BACKOFF_MS = Number(process.env.MOSS_AGENT_RESTART_BACKOFF_MS) || 5000;
export const RESTART_BACKOFF_MAX_MS = Number(process.env.MOSS_AGENT_RESTART_BACKOFF_MAX_MS) || 60000;
export const MAX_STAGE_ATTEMPTS = Number(process.env.MOSS_MAX_STAGE_ATTEMPTS) || 3;

/**
 * 自定义错误类型：用于标识任务等待用户确认的特殊状态。
 * 避免使用字符串匹配（脆弱），改用类型判断。
 */
export class WaitingForConfirmationError extends Error {
  constructor() {
    super("WAITING_FOR_CONFIRMATION");
    this.name = "WaitingForConfirmationError";
  }
}

/**
 * 确认流程业务错误，携带 HTTP 状态码供路由层使用。
 */
export class ConfirmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ConfirmError";
  }
}

export type TaskEvent =
  | { type: "log"; taskId: string; log: import("@/lib/types").TaskLog }
  | { type: "task"; taskId: string; task: import("@/lib/types").TaskWithRelations | null }
  | { type: "heartbeat"; taskId: string; at: string };
