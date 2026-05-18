"use client";

import { useState, useCallback } from "react";
import type { AgentConfirmationRequest } from "@/lib/agents/types";

interface UseTaskConfirmationOptions {
  taskId: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useTaskConfirmation({ taskId, onSuccess, onError }: UseTaskConfirmationOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const confirm = useCallback(
    async (response: string) => {
      setIsSubmitting(true);
      try {
        const res = await fetch(`/api/tasks/${taskId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "确认请求失败");
        }

        onSuccess?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error("确认请求失败"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [taskId, onSuccess, onError]
  );

  const cancel = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: "POST",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "取消请求失败");
      }

      onSuccess?.();
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("取消请求失败"));
    } finally {
      setIsSubmitting(false);
    }
  }, [taskId, onSuccess, onError]);

  return {
    confirm,
    cancel,
    isSubmitting,
  };
}

/**
 * 从任务错误消息中解析确认请求
 */
export function parseConfirmationRequest(errorMessage: string | null): AgentConfirmationRequest | null {
  if (!errorMessage) return null;
  try {
    const parsed = JSON.parse(errorMessage);
    if (parsed.question) {
      return parsed as AgentConfirmationRequest;
    }
  } catch {
    // 不是 JSON 格式，不是确认请求
  }
  return null;
}
