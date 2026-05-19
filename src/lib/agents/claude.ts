import type { AgentAdapter, AgentRunContext, AgentRunResult } from "@/lib/agents/types";
import { commandExists, runProcess } from "@/lib/agents/process";
import { detectConfirmationRequest, buildConfirmationInstruction } from "./confirmation";
import { extractSkillSummary } from "@/lib/server/skills";

const CLAUDE_TIMEOUT_MS = Number(process.env.MOSS_CLAUDE_TIMEOUT_MS) || 20 * 60 * 1000; // 20 分钟

function claudeBin() {
  return process.env.MOSS_CLAUDE_BIN || "claude";
}

function permissionMode(permission: AgentRunContext["permission"]) {
  if (permission === "readOnly") return "plan";
  if (permission === "fullAccess") return "auto";
  return "acceptEdits";
}

// 清理用户输入，防止 prompt 注入
function sanitizeUserInput(input: string): string {
  return input
    .replace(/\b(ignore|disregard|forget)\s+(previous|above|all)\s+(instructions?|prompts?|rules?)\b/gi, '[FILTERED]')
    .replace(/\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|new\s+instructions?)\b/gi, '[FILTERED]')
    .replace(/\b(system|assistant|user)\s*:\s*/gi, '[FILTERED]:')
    .slice(0, 50000);
}

function buildSkillInstructions(skills: AgentRunContext["skills"]): string | null {
  if (!skills || skills.length === 0) return null;

  const builtinSkills = skills.filter((s) => s.builtin);
  const normalSkills = skills.filter((s) => !s.builtin);

  const parts = ["=== 已选择技能 ==="];

  // 内置命令提示
  if (builtinSkills.length > 0) {
    parts.push("");
    parts.push("可用内置命令（根据需要自行使用）：");
    for (const skill of builtinSkills) {
      parts.push(`- ${skill.command || `/${skill.id}`}: ${skill.description || skill.label}`);
    }
  }

  // 普通技能注入
  if (normalSkills.length > 0) {
    parts.push("");
    parts.push("你必须优先使用以下技能完成任务：");

    for (const skill of normalSkills) {
      parts.push("");
      parts.push(`Skill: ${skill.id}`);
      if (skill.description) parts.push(`Description: ${skill.description}`);
      parts.push(`Invocation: 如当前 Claude Code 环境支持 slash skill，请使用 ${skill.command || `/${skill.id}`}；否则按以下技能说明执行。`);

      if (skill.path) {
        const summary = extractSkillSummary(skill.path);
        if (summary) {
          parts.push("Instructions:");
          parts.push(summary);
        }
      }
    }
  }

  parts.push("");
  parts.push("=== 已选择技能结束 ===");
  return parts.join("\n");
}

function buildPrompt(role: string, context: AgentRunContext) {
  const parts = [
    `你是协作调度平台中的 Claude Code ${role} agent。`,
    "请复用本机 Claude Code 配置和可用子 agent 能力。",
    "输出必须包含结论、关键理由、下一步建议。",
    `预算档位：${context.budget}`,
    buildConfirmationInstruction(),
  ];

  // 注入技能说明
  const skillInstructions = buildSkillInstructions(context.skills);
  if (skillInstructions) {
    parts.push("");
    parts.push(skillInstructions);
  }

  // 恢复执行说明
  const attempt = context.attempt ?? 1;
  if (attempt > 1) {
    parts.push("");
    parts.push(`⚠️ 这是第 ${attempt} 次执行此阶段（上次执行未完成或需要恢复）。`);
    parts.push("请先读取以下恢复上下文，了解已完成内容和当前工作区状态。");
    parts.push("已完成的内容不要重做；继续完成未交付部分。");
  }

  if (context.resumeHint) {
    parts.push("");
    parts.push("=== 恢复上下文 ===");
    parts.push(context.resumeHint);
    parts.push("=== 恢复上下文结束 ===");
  }

  parts.push("");
  parts.push("=== 用户任务开始 ===");
  parts.push(sanitizeUserInput(context.prompt));
  parts.push("=== 用户任务结束 ===");

  return parts.join("\n");
}

async function executeWithResult(context: AgentRunContext, role: string): Promise<AgentRunResult> {
  const result = await runProcess({
    command: claudeBin(),
    args: ["-p", buildPrompt(role, context), "--permission-mode", permissionMode(context.permission)],
    cwd: context.projectPath,
    timeoutMs: context.timeoutMs ?? CLAUDE_TIMEOUT_MS,
    signal: context.signal,
    onStdout: (chunk) => context.onLog(chunk),
    onStderr: (chunk) => context.onLog(chunk, { stream: "stderr" }),
  });

  const summary = result.stdout.trim() || result.stderr.trim() || "Claude Code 执行结束";

  // 检测确认请求
  const confirmationRequest = detectConfirmationRequest(result.stdout);

  return {
    ok: result.exitCode === 0 && !result.timedOut && !confirmationRequest,
    summary,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    aborted: result.aborted,
    signal: result.signal,
    confirmationRequest,
  };
}

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  label: "Claude Code",

  async detect() {
    const command = claudeBin();
    const result = await commandExists(command, ["--version"]);
    return {
      id: "claude",
      label: "Claude Code",
      available: result.available,
      command,
      version: result.available ? result.output || null : null,
      message: result.available
        ? "Claude Code CLI 可用"
        : "未找到 Claude Code CLI，请安装 claude 或配置 MOSS_CLAUDE_BIN",
    };
  },

  async run(context) {
    return executeWithResult(context, "执行");
  },

  async review(context) {
    return executeWithResult(context, "审查");
  },
};
