import React from "react";
import type { AgentSkill, TaskSkillSelection } from "@/lib/types";

interface SelectedSkillChipsProps {
  skillSelection: TaskSkillSelection;
  skills: AgentSkill[];
  onRemove: (skillId: string) => void;
  disabled?: boolean;
}

export function SelectedSkillChips({ skillSelection, skills, onRemove, disabled }: SelectedSkillChipsProps) {
  const getSkillById = (id: string) => skills.find((s) => s.id === id);

  const hasSelections = skillSelection.claude.length > 0 || skillSelection.codex.length > 0;
  if (!hasSelections) return null;

  return (
    <div className="selectedSkillChips">
      {skillSelection.claude.map((id) => {
        const skill = getSkillById(id);
        if (!skill) return null;
        return (
          <div key={`claude-${id}`} className="selectedSkillChip selectedSkillChipClaude">
            <span className="selectedSkillChipLabel">Claude: {skill.label}</span>
            {!disabled && (
              <button
                className="selectedSkillChipRemove"
                onClick={() => onRemove(id)}
                title="移除技能"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {skillSelection.codex.map((id) => {
        const skill = getSkillById(id);
        if (!skill) return null;
        return (
          <div key={`codex-${id}`} className="selectedSkillChip selectedSkillChipCodex">
            <span className="selectedSkillChipLabel">Codex: {skill.label}</span>
            {!disabled && (
              <button
                className="selectedSkillChipRemove"
                onClick={() => onRemove(id)}
                title="移除技能"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
