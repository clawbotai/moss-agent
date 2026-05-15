"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, X, Brain } from "lucide-react";
import type { ProjectMemory } from "@/lib/types";

interface MemoryConfirmProps {
  projectId: string;
  taskId: string;
}

export function MemoryConfirm({ projectId, taskId }: MemoryConfirmProps) {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPending() {
      try {
        const response = await fetch(`/api/projects/${projectId}/memory?status=draft`);
        if (!response.ok) return;
        const data = await response.json();
        // 只显示当前任务产生的草稿记忆
        const taskMemories = (data.memories as ProjectMemory[]).filter(
          (m) => m.taskId === taskId
        );
        setMemories(taskMemories);
      } catch (err) {
        console.error("获取待确认记忆失败:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchPending();
  }, [projectId, taskId]);

  const handleConfirm = useCallback(async (memoryId: string) => {
    setConfirming((prev) => new Set(prev).add(memoryId));
    try {
      const response = await fetch(`/api/projects/${projectId}/memory/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryIds: [memoryId] }),
      });
      if (response.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      }
    } finally {
      setConfirming((prev) => {
        const next = new Set(prev);
        next.delete(memoryId);
        return next;
      });
    }
  }, [projectId]);

  const handleReject = useCallback(async (memoryId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/memory/${memoryId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== memoryId));
      } else {
        setError("删除失败，请重试");
      }
    } catch (err) {
      console.error("删除记忆失败:", err);
      setError("删除失败，请检查网络连接");
    }
  }, [projectId]);

  const handleConfirmAll = useCallback(async () => {
    const ids = memories.map((m) => m.id);
    if (!ids.length) return;
    setConfirming(new Set(ids));
    try {
      const response = await fetch(`/api/projects/${projectId}/memory/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryIds: ids }),
      });
      if (response.ok) {
        setMemories([]);
      }
    } finally {
      setConfirming(new Set());
    }
  }, [projectId, memories]);

  if (loading || memories.length === 0) return null;

  const categoryLabels: Record<string, string> = {
    architecture: "架构",
    decision: "决策",
    convention: "规范",
    issue: "问题",
    context: "上下文",
  };

  return (
    <div className="memory-confirm-panel">
      <div className="memory-confirm-header">
        <Brain size={16} />
        <span>项目记忆提取</span>
        <span className="memory-confirm-count">{memories.length} 条待确认</span>
        {error && <span className="memory-confirm-error">{error}</span>}
        <button
          className="memory-confirm-all-btn"
          onClick={handleConfirmAll}
          disabled={confirming.size > 0}
        >
          全部确认
        </button>
      </div>
      <div className="memory-confirm-list">
        {memories.map((memory) => (
          <div key={memory.id} className="memory-confirm-item">
            <div className="memory-confirm-item-header">
              <span className="memory-category-tag">
                {categoryLabels[memory.category] || memory.category}
              </span>
              <div className="memory-confirm-actions">
                <button
                  className="memory-action-btn memory-action-confirm"
                  onClick={() => handleConfirm(memory.id)}
                  disabled={confirming.has(memory.id)}
                  title="确认"
                >
                  <Check size={14} />
                </button>
                <button
                  className="memory-action-btn memory-action-reject"
                  onClick={() => handleReject(memory.id)}
                  disabled={confirming.has(memory.id)}
                  title="删除"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="memory-confirm-content">
              {memory.content.slice(0, 200)}
              {memory.content.length > 200 ? "..." : ""}
            </div>
            {memory.tags.length > 0 && (
              <div className="memory-confirm-tags">
                {memory.tags.map((tag) => (
                  <span key={tag} className="memory-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
