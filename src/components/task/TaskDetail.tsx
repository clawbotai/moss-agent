"use client";

import { useMemo } from "react";
import type { TaskLog } from "@/lib/types";
import type { TaskDetailProps } from "./types";
import { buildConversationTurns } from "./utils";
import { ConversationTurnView, TimelineDebugLogs } from "./TimelineItems";
import { MemoryConfirm } from "@/components/task/MemoryConfirm";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { useTaskConfirmation, parseConfirmationRequest } from "@/hooks/useTaskConfirmation";

const MIN_AGENT_OUTPUT_LENGTH = 100;

export function TaskDetail({ task }: TaskDetailProps) {
  const logsByStage = useMemo(() => {
    const map = new Map<string, TaskLog[]>();
    if (!task) return map;
    for (const log of task.logs) {
      if (!log.stageId) continue;
      const current = map.get(log.stageId) || [];
      current.push(log);
      map.set(log.stageId, current);
    }
    return map;
  }, [task]);

  const taskLevelLogs = useMemo(() => {
    if (!task) return [];
    return task.logs.filter((log) => !log.stageId);
  }, [task]);

  const conversationTurns = useMemo(() => {
    if (!task) return [];
    return buildConversationTurns(task);
  }, [task]);

  const confirmationRequest = useMemo(() => {
    if (!task || task.status !== "waiting") return null;
    const parsed = parseConfirmationRequest(task.errorMessage);
    if (!parsed) return null;
    if (parsed.rawOutput) return parsed;

    const confirmationLogs = task.logs.filter(
      (log) => log.stageId
        && log.payload
        && typeof log.payload === "object"
        && "confirmationRequest" in (log.payload as Record<string, unknown>),
    );
    if (confirmationLogs.length === 0) return parsed;

    // 取最后一个确认日志的 stageId（最接近当前等待状态）
    const lastConfirmLog = confirmationLogs[confirmationLogs.length - 1];
    const stageId = lastConfirmLog.stageId;

    const agentOutputLog = task.logs
      .filter((log) => log.stageId === stageId && typeof log.message === "string" && log.message.length > MIN_AGENT_OUTPUT_LENGTH)
      .sort((a, b) => (b.message?.length ?? 0) - (a.message?.length ?? 0))[0];

    if (agentOutputLog?.message) {
      return { ...parsed, rawOutput: agentOutputLog.message };
    }
    return parsed;
  }, [task]);

  const { confirm, cancel, isSubmitting } = useTaskConfirmation({
    taskId: task?.id || "",
    onSuccess: () => {
      // 任务状态会通过 SSE 自动更新
    },
  });

  if (!task) return null;

  return (
    <section className="detailPanel taskRunView fade-in">
      <div className="timelineStream">
        {conversationTurns.map((turn) => (
          <ConversationTurnView key={turn.key} turn={turn} logsByStage={logsByStage} />
        ))}

        {taskLevelLogs.length > 0 && <TimelineDebugLogs logs={taskLevelLogs} />}

        {/* 确认对话框 */}
        {task.status === "waiting" && confirmationRequest && (
          <ConfirmationDialog
            key={`${task.id}-${task.errorMessage ?? ""}`}
            confirmationRequest={confirmationRequest}
            onConfirm={confirm}
            onCancel={cancel}
            isSubmitting={isSubmitting}
          />
        )}

        {task.status === "completed" && task.project && (
          <MemoryConfirm projectId={task.projectId} taskId={task.id} />
        )}
      </div>
    </section>
  );
}
