"use client";

import { useState, useCallback, useRef } from "react";
import type { AgentConfirmationRequest } from "@/lib/agents/types";

interface UseTaskConfirmationOptions {
  taskId: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useTaskConfirmation({ taskId, onSuccess, onError }: UseTaskConfirmationOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const confirm = useCallback(
    async (response: string) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/tasks/${taskId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "确认请求失败");
        }

        onSuccessRef.current?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : "确认请求失败";
        setError(message);
        onErrorRef.current?.(err instanceof Error ? err : new Error(message));
      } finally {
        setIsSubmitting(false);
      }
    },
    [taskId],
  );

  const cancel = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "取消请求失败");
      }

      onSuccessRef.current?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "取消请求失败";
      setError(message);
      onErrorRef.current?.(err instanceof Error ? err : new Error(message));
    } finally {
      setIsSubmitting(false);
    }
  }, [taskId]);

  return {
    confirm,
    cancel,
    isSubmitting,
    error,
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