"use client";

import { useMemo } from "react";
import type { TaskLog } from "@/lib/types";
import type { TaskDetailProps } from "./types";
import { buildConversationTurns } from "./utils";
import { ConversationTurnView, TimelineDebugLogs } from "./TimelineItems";
import { MemoryConfirm } from "@/components/task/MemoryConfirm";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { useTaskConfirmation, parseConfirmationRequest } from "@/hooks/useTaskConfirmation";

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

  // 解析确认请求
  const confirmationRequest = useMemo(() => {
    if (!task || task.status !== "waiting") return null;
    return parseConfirmationRequest(task.errorMessage);
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
