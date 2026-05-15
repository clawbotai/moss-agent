"use client";

import { GitBranchPlus, Loader2, MessageSquarePlus, Send, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import type { BudgetLevel, MemoryMode, PermissionLevel, TaskMode } from "@/lib/types";
import { Select } from "@/components/common/Select";

interface ComposerProps {
  prompt: string;
  mode: TaskMode;
  budget: BudgetLevel;
  permission: PermissionLevel;
  memoryMode: MemoryMode;
  includePromptInContext: boolean;
  busy: boolean;
  selectedProjectId: string;
  hasSelectedTask: boolean;
  error: string;
  onPromptChange: (prompt: string) => void;
  onModeChange: (mode: TaskMode) => void;
  onBudgetChange: (budget: BudgetLevel) => void;
  onPermissionChange: (permission: PermissionLevel) => void;
  onMemoryModeChange: (memoryMode: MemoryMode) => void;
  onIncludePromptInContextChange: (include: boolean) => void;
  onSubmit: (event?: FormEvent) => void;
  onCreateTask: () => void;
  onDeriveTask: () => void;
}

export function Composer({
  prompt,
  mode,
  budget,
  permission,
  memoryMode,
  includePromptInContext,
  busy,
  selectedProjectId,
  hasSelectedTask,
  error,
  onPromptChange,
  onModeChange,
  onBudgetChange,
  onPermissionChange,
  onMemoryModeChange,
  onIncludePromptInContextChange,
  onSubmit,
  onCreateTask,
  onDeriveTask,
}: ComposerProps) {
  const promptReady = !!prompt.trim();
  const projectReady = !!selectedProjectId;
  const submitDisabled = busy || !projectReady || !promptReady;
  const deriveDisabled = busy || !projectReady || !promptReady;

  const placeholder = hasSelectedTask
    ? "在当前任务下追加说明..."
    : "输入新任务指令...";
  const submitLabel = hasSelectedTask ? "发送到当前任务" : "创建新任务";

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
        <Select value={memoryMode} onChange={(value) => onMemoryModeChange(value as MemoryMode)}>
          <option value="off">关闭记忆</option>
          <option value="taskSummary">任务摘要记忆</option>
          <option value="projectMemory">项目记忆</option>
        </Select>
      </div>
      <div className="promptRow">
        <Sparkles size={18} />
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={placeholder}
          rows={2}
          aria-label={placeholder}
        />
        <button disabled={submitDisabled} type="submit" title={submitLabel} aria-label={submitLabel}>
          {busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
        </button>
      </div>
      {hasSelectedTask && (
        <div className="composerActions">
          <label className="contextToggle">
            <input
              type="checkbox"
              checked={includePromptInContext}
              onChange={(event) => onIncludePromptInContextChange(event.target.checked)}
            />
            本条消息进入后续上下文
          </label>
          <button disabled={submitDisabled} type="button" onClick={onCreateTask}>
            <MessageSquarePlus size={14} />
            新开任务
          </button>
          <button disabled={deriveDisabled} type="button" onClick={onDeriveTask}>
            <GitBranchPlus size={14} />
            基于此任务继续
          </button>
        </div>
      )}
      {error && <div className="errorLine">{error}</div>}
    </form>
  );
}
