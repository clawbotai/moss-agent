"use client";

import { useEffect, useState } from "react";
import type { TaskLog, TaskWithRelations } from "@/lib/types";

const MAX_RETRIES = 5;
const BASE_DELAY = 1000;
const MAX_LOGS = 300;

export function useTaskEvents(
  selectedTaskId: string | null,
  onTaskUpdate?: (task: TaskWithRelations) => void
) {
  const [taskDetails, setTaskDetails] = useState<TaskWithRelations | null>(null);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskDetails(null);
      return;
    }

    let closed = false;
    let retryCount = 0;

    async function fetchTask() {
      try {
        const response = await fetch(`/api/tasks/${selectedTaskId}`);
        if (!response.ok) return;
        const data = (await response.json()) as { task: TaskWithRelations };
        if (!closed) {
          setTaskDetails(data.task);
        }
      } catch {
        // 忽略获取错误，SSE 会更新
      }
    }

    void fetchTask();

    function connect() {
      const source = new EventSource(`/api/tasks/${selectedTaskId}/events`);

      source.addEventListener("snapshot", (event) => {
        if (closed) return;
        retryCount = 0;
        const data = JSON.parse((event as MessageEvent).data) as {
          task: TaskWithRelations | null;
          logs: TaskLog[];
        };
        setTaskDetails(data.task ? { ...data.task, logs: data.logs } : null);
      });

      source.addEventListener("task", (event) => {
        if (closed) return;
        const data = JSON.parse((event as MessageEvent).data) as { task: TaskWithRelations | null };
        if (data.task) {
          setTaskDetails(data.task);
          onTaskUpdate?.(data.task);
        }
      });

      source.addEventListener("log", (event) => {
        if (closed) return;
        const data = JSON.parse((event as MessageEvent).data) as { log: TaskLog };
        setTaskDetails((current) =>
          current
            ? {
                ...current,
                logs: [...current.logs, data.log].slice(-MAX_LOGS),
              }
            : current,
        );
      });

      source.onerror = () => {
        source.close();
        if (!closed && retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = BASE_DELAY * Math.pow(2, retryCount - 1);
          setTimeout(connect, delay);
        }
      };

      return source;
    }

    const source = connect();

    return () => {
      closed = true;
      source.close();
    };
  }, [selectedTaskId]);

  return { taskDetails, setTaskDetails };
}
