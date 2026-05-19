import fs from "node:fs";
import path from "node:path";
import type { AgentId, AgentSkill, SkillAgent, SkillSource, TaskMode, TaskSkillSelection } from "@/lib/types";

// 进程内短缓存
let cachedSkills: AgentSkill[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000; // 30 秒

const BUILTIN_COMMANDS: AgentSkill[] = [
  { id: "compact", label: "compact", agent: "both", source: "builtin", path: null, description: "压缩对话历史，减少上下文占用", command: "/compact", builtin: true },
  { id: "clear", label: "clear", agent: "both", source: "builtin", path: null, description: "清除对话，开始新会话", command: "/clear", builtin: true },
  { id: "context", label: "context", agent: "both", source: "builtin", path: null, description: "查看当前上下文状态", command: "/context", builtin: true },
  { id: "add-dir", label: "add-dir", agent: "both", source: "builtin", path: null, description: "添加目录到工作区", command: "/add-dir", builtin: true },
];

function getCodexSkillsDir(): string {
  return path.join(process.env.HOME || "~", ".codex", "skills");
}

function getClaudeSkillsDir(): string {
  return path.join(process.env.HOME || "~", ".claude", "skills");
}

function getProjectSkillsDir(): string {
  return path.join(process.cwd(), ".moss-agent", "skills");
}

function scanSkillDirectory(dir: string, source: SkillSource, defaultAgent: SkillAgent): AgentSkill[] {
  if (!fs.existsSync(dir)) return [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const skills: AgentSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, "utf-8");
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const descMatch = content.match(/^>\s*(.+)$/m) || content.match(/description[:\s]+(.+)$/mi);

      skills.push({
        id: `${source}:${entry.name}`,
        label: entry.name,
        agent: defaultAgent,
        source,
        path: skillPath,
        description: descMatch?.[1]?.trim() || titleMatch?.[1]?.trim() || null,
        command: `/${entry.name}`,
        builtin: false,
      });
    }

    return skills;
  } catch {
    return [];
  }
}

export function listAvailableSkills(forceRefresh = false): AgentSkill[] {
  const now = Date.now();
  if (!forceRefresh && cachedSkills && now - cacheTimestamp < CACHE_TTL) {
    return cachedSkills;
  }

  const skills: AgentSkill[] = [
    ...BUILTIN_COMMANDS,
    ...scanSkillDirectory(getClaudeSkillsDir(), "claude-skill", "claude"),
    ...scanSkillDirectory(getCodexSkillsDir(), "codex-skill", "codex"),
    ...scanSkillDirectory(getProjectSkillsDir(), "project", "both"),
  ];

  cachedSkills = skills;
  cacheTimestamp = now;
  return skills;
}

export function filterSkillsByMode(skills: AgentSkill[], mode: TaskMode): AgentSkill[] {
  if (mode === "custom") return [];
  if (mode === "codexOnly") return skills.filter((s) => s.agent === "codex" || s.agent === "both" || s.builtin);
  if (mode === "claudeOnly") return skills.filter((s) => s.agent === "claude" || s.agent === "both" || s.builtin);
  return skills; // collaborative
}

export function findSkillById(skills: AgentSkill[], id: string): AgentSkill | undefined {
  const exact = skills.find((skill) => skill.id === id);
  if (exact) return exact;

  const legacyMatches = skills.filter((skill) => skill.label === id);
  return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
}

export function validateSkillSelection(
  selection: TaskSkillSelection,
  mode: TaskMode,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allSkills = listAvailableSkills();

  // 1. 存在性校验
  for (const id of [...selection.claude, ...selection.codex]) {
    const found = findSkillById(allSkills, id);
    if (!found) {
      errors.push(`Skill "${id}" 不存在或不可用`);
    }
  }

  // 2. Mode 兼容性校验
  if (mode === "custom") {
    if (selection.claude.length > 0 || selection.codex.length > 0) {
      errors.push("自定义 agent 模式不支持 skill 选择");
    }
  }

  if (mode === "codexOnly") {
    for (const id of selection.claude) {
      errors.push(`Skill "${id}" 不能分配给 Claude：当前 codexOnly 模式不会运行 Claude 阶段`);
    }
  }

  if (mode === "claudeOnly") {
    for (const id of selection.codex) {
      errors.push(`Skill "${id}" 不能分配给 Codex：当前 claudeOnly 模式不会运行 Codex 阶段`);
    }
  }

  for (const id of selection.claude) {
    const found = findSkillById(allSkills, id);
    if (found && found.agent === "codex") {
      errors.push(`Skill "${found.label}" 仅适用于 Codex，不能分配给 Claude`);
    }
  }

  for (const id of selection.codex) {
    const found = findSkillById(allSkills, id);
    if (found && found.agent === "claude") {
      errors.push(`Skill "${found.label}" 仅适用于 Claude，不能分配给 Codex`);
    }
  }

  // 3. 数量校验
  if (selection.claude.length > 1) {
    errors.push("第一版每个 agent 最多选择 1 个 skill（Claude）");
  }
  if (selection.codex.length > 1) {
    errors.push("第一版每个 agent 最多选择 1 个 skill（Codex）");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function resolveSkillAgentForMode(
  skill: AgentSkill,
  mode: TaskMode,
): "claude" | "codex" | "both" {
  if (skill.agent !== "both") return skill.agent;
  if (mode === "codexOnly") return "codex";
  if (mode === "claudeOnly") return "claude";
  return "both";
}

export function resolveSkillsForStage(
  selection: TaskSkillSelection,
  stageAgent: AgentId,
): AgentSkill[] {
  const allSkills = listAvailableSkills();
  const agentKeys = stageAgent === "claude" ? ["claude"] : stageAgent === "codex" ? ["codex"] : [];
  const skillIds = agentKeys.flatMap((key) => selection[key as keyof TaskSkillSelection] ?? []);
  return skillIds
    .map((id) => findSkillById(allSkills, id))
    .filter((s): s is AgentSkill => s !== undefined);
}

function parseMarkdownSections(raw: string): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];
  const lines = raw.split("\n");
  let currentHeading = "";
  let currentContent = "";

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading) {
        sections.push({ heading: currentHeading, content: currentContent.trim() });
      }
      currentHeading = line;
      currentContent = "";
    } else {
      currentContent += line + "\n";
    }
  }

  if (currentHeading) {
    sections.push({ heading: currentHeading, content: currentContent.trim() });
  }

  return sections;
}

export function extractSkillSummary(skillPath: string, maxChars: number = 6000): string | null {
  if (!fs.existsSync(skillPath)) return null;

  const raw = fs.readFileSync(skillPath, "utf-8");
  if (raw.length <= maxChars) return raw;

  const sections = parseMarkdownSections(raw);
  const priority = ["description", "trigger", "triggers", "when to use", "workflow", "steps", "procedure", "scripts", "commands", "tools", "usage"];

  let result = "";
  const titleMatch = raw.match(/^#\s+.+/m);
  if (titleMatch) result += titleMatch[0] + "\n\n";

  for (const keyword of priority) {
    const section = sections.find((s) => s.heading.toLowerCase().includes(keyword));
    if (section && result.length + section.content.length <= maxChars) {
      result += section.content + "\n\n";
    }
  }

  for (const section of sections) {
    if (!result.includes(section.content) && result.length + section.content.length <= maxChars) {
      result += section.content + "\n\n";
    }
  }

  if (result.length < raw.length && result.length < maxChars - 100) {
    result += `\n[技能内容已精简，完整内容见 ${skillPath}]`;
  }

  return result.slice(0, maxChars);
}
