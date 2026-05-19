import type { TaskStage } from "@/lib/types";
import { MAX_LOG_LENGTH, MAX_STAGE_SUMMARY_LENGTH } from "./types";

export function collectRoleSummary(
  stage: TaskStage,
  mossAnswerSummaries: string[],
  deliverableSummaries: string[],
) {
  if (!stage.outputSummary) return;
  const truncated = stage.outputSummary.slice(0, MAX_STAGE_SUMMARY_LENGTH);
  if (stage.role === "audit") {
    mossAnswerSummaries.push(truncated);
  }
  if (stage.role === "implement") {
    deliverableSummaries.push(`${stage.name}：${truncated}`);
  }
}

export function normalizeLogChunk(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "[空输出]";
  return trimmed.length > MAX_LOG_LENGTH ? `${trimmed.slice(0, MAX_LOG_LENGTH)}...` : trimmed;
}

/**
 * 从 agent_run 的 command 字符串中解析 attempt 序号
 * 格式: "claude plan (attempt 2)" -> 2
 *
 * 注意：这个方法依赖 command 字符串格式，如果格式变化会 fallback 到 1。
 * 未来建议在 agent_runs 表中添加 attempt 列来结构化存储。
 */
export function parseAttemptFromCommand(command: string) {
  const match = command.match(/\(attempt\s+(\d+)\)/i);
  if (!match) return 1;
  const attempt = Number.parseInt(match[1], 10);
  return Number.isFinite(attempt) && attempt > 0 ? attempt : 1;
}
