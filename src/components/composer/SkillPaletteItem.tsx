import React from "react";
import type { AgentSkill } from "@/lib/types";

interface SkillPaletteItemProps {
  skill: AgentSkill;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: (skill: AgentSkill) => void;
  onHighlight: () => void;
}

export function SkillPaletteItem({ skill, isSelected, isHighlighted, onSelect, onHighlight }: SkillPaletteItemProps) {
  const getAgentTag = () => {
    if (skill.builtin) return { label: "内置", className: "skillTagBuiltin" };
    if (skill.agent === "both") return { label: "Both", className: "skillTagBoth" };
    if (skill.agent === "claude") return { label: "Claude", className: "skillTagClaude" };
    return { label: "Codex", className: "skillTagCodex" };
  };

  const tag = getAgentTag();

  return (
    <div
      className={`skillPaletteItem ${isHighlighted ? "skillPaletteItemActive" : ""} ${isSelected ? "skillPaletteItemSelected" : ""}`}
      onClick={() => onSelect(skill)}
      onMouseEnter={onHighlight}
      role="option"
      aria-selected={isSelected}
    >
      <div className="skillPaletteItemHeader">
        <span className="skillPaletteItemCommand">{skill.command || `/${skill.id}`}</span>
        <span className={`skillTag ${tag.className}`}>{tag.label}</span>
      </div>
      {skill.description && (
        <div className="skillPaletteItemDescription">{skill.description}</div>
      )}
    </div>
  );
}
