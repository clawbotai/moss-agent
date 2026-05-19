import type { AgentSkill, TaskMode, TaskSkillSelection } from "@/lib/types";

export function filterSkillsByMode(skills: AgentSkill[], mode: TaskMode): AgentSkill[] {
  if (mode === "custom") return skills.filter((s) => s.builtin);
  if (mode === "codexOnly") return skills.filter((s) => s.agent === "codex" || s.agent === "both" || s.builtin);
  if (mode === "claudeOnly") return skills.filter((s) => s.agent === "claude" || s.agent === "both" || s.builtin);
  return skills;
}

export function isSkillSelectionEmpty(selection: TaskSkillSelection): boolean {
  return selection.claude.length === 0 && selection.codex.length === 0;
}

export function getSkillIdsFromSelection(selection: TaskSkillSelection): string[] {
  return [...selection.claude, ...selection.codex];
}

export function removeSkillFromSelection(selection: TaskSkillSelection, skillId: string): TaskSkillSelection {
  return {
    claude: selection.claude.filter((id) => id !== skillId),
    codex: selection.codex.filter((id) => id !== skillId),
  };
}
