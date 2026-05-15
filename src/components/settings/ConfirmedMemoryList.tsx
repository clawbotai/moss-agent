"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { ProjectMemory } from "@/lib/types";

interface ConfirmedMemoryListProps {
  memories: ProjectMemory[];
  onDelete: (memoryId: string) => Promise<void>;
}

export function ConfirmedMemoryList({ memories, onDelete }: ConfirmedMemoryListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(memoryId: string) {
    setDeletingId(memoryId);
    try {
      await onDelete(memoryId);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <hr className="memoryListDivider" />
      <div className="memoryListTitle">已确认记忆</div>
      {memories.length === 0 ? (
        <p className="memoryListEmpty">暂无已确认项目记忆</p>
      ) : (
        <div className="memoryList">
          {memories.map((memory) => (
            <div key={memory.id} className="memoryItem">
              <div className="memoryItemBody">
                <span className="memoryItemCategory">{memory.category}</span>
                <p className="memoryItemContent">{memory.content}</p>
              </div>
              <button
                type="button"
                className="memoryItemDelete"
                aria-label={`删除记忆：${memory.content.slice(0, 30)}`}
                disabled={deletingId === memory.id}
                onClick={() => handleDelete(memory.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
