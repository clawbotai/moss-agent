"use client";

import { useState, useCallback } from "react";
import { Loader2, Send } from "lucide-react";
import type { FormEvent } from "react";
import type { AgentSkill, BudgetLevel, PermissionLevel, TaskMode, TaskSkillSelection } from "@/lib/types";
import { Select } from "@/components/common/Select";
import { SkillTriggerButton } from "./SkillTriggerButton";
import { SkillPalette } from "./SkillPalette";
import { SelectedSkillChips } from "./SelectedSkillChips";
import { removeSkillFromSelection } from "./skill-utils";

interface ComposerProps {
  prompt: string;
  mode: TaskMode;
  budget: BudgetLevel;
  permission: PermissionLevel;
  busy: boolean;
  selectedProjectId: string;
  hasSelectedTask: boolean;
  error: string;
  skills: AgentSkill[];
  skillSelection: TaskSkillSelection;
  onSkillSelectionChange: (selection: TaskSkillSelection) => void;
  onRefreshSkills: () => void;
  skillsLoading: boolean;
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
  hasSelectedTask,
  error,
  skills,
  skillSelection,
  onSkillSelectionChange,
  onRefreshSkills,
  skillsLoading,
  onPromptChange,
  onModeChange,
  onBudgetChange,
  onPermissionChange,
  onSubmit,
}: ComposerProps) {
  const [isSkillPaletteOpen, setIsSkillPaletteOpen] = useState(false);
  const promptReady = !!prompt.trim();
  const projectReady = !!selectedProjectId;
  const submitDisabled = busy || !projectReady || !promptReady;

  const placeholder = hasSelectedTask ? "追加当前任务说明..." : "输入新任务指令...";
  const submitLabel = hasSelectedTask ? "追加到当前任务" : "创建新任务";

  const handleTogglePalette = useCallback(() => {
    setIsSkillPaletteOpen((prev) => !prev);
  }, []);

  const handleClosePalette = useCallback(() => {
    setIsSkillPaletteOpen(false);
  }, []);

  const handleRemoveSkill = useCallback((skillId: string) => {
    onSkillSelectionChange(removeSkillFromSelection(skillSelection, skillId));
  }, [skillSelection, onSkillSelectionChange]);

  const handlePromptChange = useCallback((value: string) => {
    onPromptChange(value);
    // 输入 / 时打开技能面板
    if (value === "/" && !isSkillPaletteOpen) {
      setIsSkillPaletteOpen(true);
    }
  }, [onPromptChange, isSkillPaletteOpen]);

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
        <SelectedSkillChips
          skillSelection={skillSelection}
          skills={skills}
          onRemove={handleRemoveSkill}
          disabled={busy}
        />
      </div>
      <div className="promptRow">
        <SkillTriggerButton
          onClick={handleTogglePalette}
          isOpen={isSkillPaletteOpen}
          disabled={mode === "custom"}
        />
        <textarea
          value={prompt}
          onChange={(event) => handlePromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (!submitDisabled) onSubmit();
            }
          }}
          placeholder={placeholder}
          rows={2}
          aria-label={placeholder}
        />
        <button className="submit" disabled={submitDisabled} type="submit" title={`${submitLabel} (Ctrl+Enter)`} aria-label={submitLabel}>
          {busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
        </button>
      </div>
      {isSkillPaletteOpen && (
        <SkillPalette
          skills={skills}
          mode={mode}
          skillSelection={skillSelection}
          onSelectionChange={onSkillSelectionChange}
          onClose={handleClosePalette}
          onRefresh={onRefreshSkills}
          loading={skillsLoading}
        />
      )}
      {error && <div className="errorLine">{error}</div>}
    </form>
  );
}
