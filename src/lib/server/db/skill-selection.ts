import type { TaskSkillSelection } from "@/lib/types";
import { EMPTY_SKILL_SELECTION } from "@/lib/types";

export function serializeSkillSelection(selection: TaskSkillSelection): string | null {
  if (selection.claude.length === 0 && selection.codex.length === 0) return null;
  return JSON.stringify(selection);
}

export function parseSkillSelection(json: string | null): TaskSkillSelection {
  if (!json) return EMPTY_SKILL_SELECTION;
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray(parsed.claude) &&
      Array.isArray(parsed.codex)
    ) {
      return { claude: parsed.claude, codex: parsed.codex };
    }
    console.warn("[MOSS] skillSelectionJson 格式异常，返回空选择", json);
    return EMPTY_SKILL_SELECTION;
  } catch {
    console.warn("[MOSS] skillSelectionJson 解析失败，返回空选择");
    return EMPTY_SKILL_SELECTION;
  }
}
