"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { X } from "lucide-react";
import { Popover } from "@/components/common/Popover";
import { SettingsNav } from "./SettingsNav";
import { MemorySettings } from "./MemorySettings";
import { GeneralSettings } from "./GeneralSettings";
import type { ProjectMemory, ProjectSettings } from "@/lib/types";

interface SettingsPopoverProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}

type SettingsModule = "memory" | "general";

export function SettingsPopover({ projectId, open, onClose, triggerRef }: SettingsPopoverProps) {
  const [activeModule, setActiveModule] = useState<SettingsModule>("general");
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!open || !projectId) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setSettings(null);
    setMemories([]);

    Promise.all([
      fetch(`/api/projects/${projectId}/settings`).then(async (response) => {
        if (!response.ok) throw new Error("加载设置失败");
        return response.json();
      }),
      fetch(`/api/projects/${projectId}/memory?status=confirmed`).then(async (response) => {
        if (!response.ok) throw new Error("加载记忆失败");
        return response.json();
      }),
    ])
      .then(([settingsData, memoryData]) => {
        if (cancelled) return;
        setSettings((settingsData as { settings: ProjectSettings }).settings);
        setMemories((memoryData as { memories: ProjectMemory[] }).memories || []);
      })
      .catch(() => {
        if (cancelled) return;
        setError("加载设置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  async function handleToggle(field: "memoryInjectEnabled" | "memoryExtractEnabled", next: boolean) {
    if (!settings || pendingRef.current) return;
    pendingRef.current = true;

    const prev = settings[field];
    setSettings({ ...settings, [field]: next });

    try {
      const response = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error || "更新失败");
      }
      const data = (await response.json()) as { settings: ProjectSettings };
      setSettings(data.settings);
    } catch {
      setSettings({ ...settings, [field]: prev });
      setError("设置更新失败，已回滚");
    } finally {
      pendingRef.current = false;
    }
  }

  async function handleDeleteMemory(memoryId: string) {
    try {
      const response = await fetch(`/api/projects/${projectId}/memory/${memoryId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error((data as { error?: string }).error || "删除失败");
      }
      setMemories((current) => current.filter((m) => m.id !== memoryId));
      setError("");
    } catch (innerError) {
      setError(innerError instanceof Error ? innerError.message : "删除记忆失败");
    }
  }

  return (
    <Popover open={open} onClose={onClose} wrapperClassName="settingsPopoverWrapper" triggerRef={triggerRef}>
      <div className="settingsPanel">
        <div className="settingsHeader">
          <h3>设置</h3>
          <button type="button" onClick={onClose} aria-label="关闭设置">
            <X size={16} />
          </button>
        </div>

        <div className="settingsBody">
          <SettingsNav activeModule={activeModule} onModuleChange={setActiveModule} />

          <div className="settingsContent">
            {loading && <p className="settingsLoading">加载中...</p>}
            {error && <p className="settingsError">{error}</p>}

            {!loading && activeModule === "memory" && (
              <MemorySettings
                settings={settings}
                memories={memories}
                onToggle={handleToggle}
                onDeleteMemory={handleDeleteMemory}
                pending={pendingRef.current}
              />
            )}

            {!loading && activeModule === "general" && (
              <GeneralSettings projectId={projectId} />
            )}
          </div>
        </div>
      </div>
    </Popover>
  );
}
