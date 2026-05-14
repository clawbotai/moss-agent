"use client";

import { Loader2, Send, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import type { BudgetLevel, PermissionLevel, TaskMode } from "@/lib/types";
import { Select } from "@/components/common/Select";

interface ComposerProps {
  prompt: string;
  mode: TaskMode;
  budget: BudgetLevel;
  permission: PermissionLevel;
  busy: boolean;
  selectedProjectId: string;
  error: string;
  onPromptChange: (prompt: string) => void;
  onModeChange: (mode: TaskMode) => void;
  onBudgetChange: (budget: BudgetLevel) => void;
  onPermissionChange: (permission: PermissionLevel) => void;
  onSubmit: (event?: FormEvent) => void;
}

export function Composer({
  prompt,
  mode,
  budget,
  permission,
  busy,
  selectedProjectId,
  error,
  onPromptChange,
  onModeChange,
  onBudgetChange,
  onPermissionChange,
  onSubmit,
}: ComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="controls">
        <Select value={mode} onChange={(value) => onModeChange(value as TaskMode)}>
          <option value="collaborative">Claude + Codex 协作</option>
          <option value="codexOnly">Codex 直接开发</option>
          <option value="claudeOnly">Claude 直接开发</option>
          <option value="custom">自定义 agent</option>
        </Select>
        <Select value={budget} onChange={(value) => onBudgetChange(value as BudgetLevel)}>
          <option value="low">低预算</option>
          <option value="standard">标准预算</option>
          <option value="high">高预算</option>
        </Select>
        <Select
          value={permission}
          onChange={(value) => onPermissionChange(value as PermissionLevel)}
        >
          <option value="readOnly">只读</option>
          <option value="workspaceWrite">工作区写入</option>
          <option value="fullAccess">完整权限</option>
        </Select>
      </div>
      <div className="promptRow">
        <Sparkles size={18} />
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="输入任务指令..."
          rows={2}
        />
        <button disabled={busy || !selectedProjectId || !prompt.trim()} type="submit">
          {busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
        </button>
      </div>
      {error && <div className="errorLine">{error}</div>}
    </form>
  );
}
