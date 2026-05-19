import React from "react";

interface SkillTriggerButtonProps {
  onClick: () => void;
  isOpen: boolean;
  disabled?: boolean;
}

export function SkillTriggerButton({ onClick, isOpen, disabled }: SkillTriggerButtonProps) {
  return (
    <button
      type="button"
      className={`skillTrigger ${isOpen ? "skillTriggerActive" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title="选择技能"
    >
      <span className="skillTriggerIcon">&gt;_</span>
    </button>
  );
}
