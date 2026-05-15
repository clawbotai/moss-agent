"use client";

import { useMemo } from "react";
import type { TaskLog } from "@/lib/types";
import type { TaskDetailProps } from "./types";
import { buildConversationTurns } from "./utils";
import { ConversationTurnView, TimelineDebugLogs } from "./TimelineItems";

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

  if (!task) return null;

  return (
    <section className="detailPanel taskRunView fade-in">
      <div className="timelineStream">
        {conversationTurns.map((turn) => (
          <ConversationTurnView key={turn.key} turn={turn} logsByStage={logsByStage} />
        ))}

        {taskLevelLogs.length > 0 && <TimelineDebugLogs logs={taskLevelLogs} />}
      </div>
    </section>
  );
}
