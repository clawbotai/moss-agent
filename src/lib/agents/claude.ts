import type { AgentAdapter, AgentRunContext } from "@/lib/agents/types";
import { commandExists, runProcess } from "@/lib/agents/process";

function claudeBin() {
  return process.env.MOSS_CLAUDE_BIN || "claude";
}

// 清理用户输入，防止 prompt 注入
function sanitizeUserInput(input: string): string {
  // 移除潜在的指令注入模式
  return input
    .replace(/\b(ignore|disregard|forget)\s+(previous|above|all)\s+(instructions?|prompts?|rules?)\b/gi, '[FILTERED]')
    .replace(/\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|new\s+instructions?)\b/gi, '[FILTERED]')
    .replace(/\b(system|assistant|user)\s*:\s*/gi, '[FILTERED]:')
    .slice(0, 50000); // 限制最大长度
}

function buildPrompt(role: string, context: AgentRunContext) {
  return [
    `你是协作调度平台中的 Claude Code ${role} agent。`,
    "请复用本机 Claude Code 配置和可用子 agent 能力。",
    "输出必须包含结论、关键理由、下一步建议。",
    `预算档位：${context.budget}`,
    "",
    "=== 用户任务开始 ===",
    sanitizeUserInput(context.prompt),
    "=== 用户任务结束 ===",
  ].join("\n");
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
    const result = await runProcess({
      command: claudeBin(),
      args: ["-p", buildPrompt("执行", context)],
      cwd: context.projectPath,
      signal: context.signal,
      onStdout: (chunk) => context.onLog(chunk),
      onStderr: (chunk) => context.onLog(chunk, { stream: "stderr" }),
    });

    const summary = result.stdout.trim() || result.stderr.trim() || "Claude Code 执行结束";
    return { ok: result.exitCode === 0, summary, exitCode: result.exitCode };
  },

  async review(context) {
    const result = await runProcess({
      command: claudeBin(),
      args: ["-p", buildPrompt("审查", context)],
      cwd: context.projectPath,
      signal: context.signal,
      onStdout: (chunk) => context.onLog(chunk),
      onStderr: (chunk) => context.onLog(chunk, { stream: "stderr" }),
    });

    const summary = result.stdout.trim() || result.stderr.trim() || "Claude Code 审查结束";
    return { ok: result.exitCode === 0, summary, exitCode: result.exitCode };
  },
};
