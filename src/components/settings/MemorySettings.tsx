"use client";

import { Trash2 } from "lucide-react";
import type { ProjectMemory, ProjectSettings } from "@/lib/types";
import { MemoryToggle } from "./MemoryToggle";

interface MemorySettingsProps {
  settings: ProjectSettings | null;
  memories: ProjectMemory[];
  onToggle: (field: "memoryInjectEnabled" | "memoryExtractEnabled", next: boolean) => void;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  pending: boolean;
}

export function MemorySettings({ settings, memories, onToggle, onDeleteMemory, pending }: MemorySettingsProps) {
  return (
    <div className="settingsModule">
      <div className="settingsModuleHeader">
        <span className="settingsModuleIcon">🧠</span>
        <span>记忆设置</span>
      </div>

      {settings && (
        <>
          <MemoryToggle
            label="记忆注入"
            description="新任务自动注入已确认的项目记忆到上下文中"
            checked={settings.memoryInjectEnabled}
            disabled={pending}
            onToggle={(next) => onToggle("memoryInjectEnabled", next)}
          />
          <MemoryToggle
            label="记忆提取"
            description="任务完成后自动提取记忆草稿，经确认后进入项目记忆"
            checked={settings.memoryExtractEnabled}
            disabled={pending}
            onToggle={(next) => onToggle("memoryExtractEnabled", next)}
          />
        </>
      )}

      <hr className="settingsDivider" />

      <div className="settingsSectionTitle">已确认记忆</div>
      {memories.length === 0 ? (
        <p className="settingsEmpty">暂无已确认项目记忆</p>
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
                onClick={() => onDeleteMemory(memory.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
