import type { AgentAdapter, AgentRunContext, AgentRunResult } from "@/lib/agents/types";
import { commandExists, runProcess } from "@/lib/agents/process";

const CODEX_TIMEOUT_MS = Number(process.env.MOSS_CODEX_TIMEOUT_MS) || 20 * 60 * 1000; // 20 分钟

function codexBin() {
  return process.env.MOSS_CODEX_BIN || "codex";
}

function sandboxArg(permission: AgentRunContext["permission"]) {
  if (permission === "readOnly") return "read-only";
  if (permission === "fullAccess") return "danger-full-access";
  return "workspace-write";
}

function budgetInstruction(budget: AgentRunContext["budget"]) {
  if (budget === "low") return "使用低 token 策略：先读关键文件，输出简明结果，避免无关探索。";
  if (budget === "high") return "可以进行较完整探索和验证，但仍要避免重复读取长日志。";
  return "使用标准 token 策略：优先摘要、关键路径和必要验证。";
}

function buildRunPrompt(context: AgentRunContext) {
  const parts = [
    "你是协作调度平台中的 Codex 开发 agent。",
    budgetInstruction(context.budget),
    "请在当前项目目录完成任务，完成后输出变更摘要、验证结果和剩余风险。",
  ];

  // 恢复执行说明
  const attempt = context.attempt ?? 1;
  if (attempt > 1) {
    parts.push("");
    parts.push(`⚠️ 这是第 ${attempt} 次执行此阶段（上次因超时被终止）。`);
    parts.push("请先检查当前工作区状态和 git diff，了解已完成内容。");
    parts.push("已完成的内容不要重做；继续完成未交付部分。");
  }

  if (context.resumeHint) {
    parts.push("");
    parts.push("=== 恢复上下文 ===");
    parts.push(context.resumeHint);
    parts.push("=== 恢复上下文结束 ===");
  }

  parts.push("");
  parts.push(context.prompt);

  return parts.join("\n");
}

function buildReviewPrompt(context: AgentRunContext) {
  const parts = [
    "你是协作调度平台中的 Codex 审查 agent。",
    "请审查给定计划或当前未提交变更，优先指出阻塞问题、风险和缺失测试。",
    "只进行审查，不要修改文件；如果需要审查代码变更，请先读取 git status 和 git diff。",
    budgetInstruction(context.budget),
  ];

  const attempt = context.attempt ?? 1;
  if (attempt > 1) {
    parts.push("");
    parts.push(`⚠️ 这是第 ${attempt} 次执行审查（上次因超时被终止）。`);
  }

  if (context.resumeHint) {
    parts.push("");
    parts.push("=== 恢复上下文 ===");
    parts.push(context.resumeHint);
    parts.push("=== 恢复上下文结束 ===");
  }

  parts.push("");
  parts.push(context.prompt);

  return parts.join("\n");
}

function extractCodexSummary(stdout: string) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: string;
        content?: string;
        item?: { type?: string; text?: string };
      };
      if (event.message) return event.message;
      if (event.content) return event.content;
      // Codex 的 item.completed 事件中 agent_message 类型包含最终输出
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        return event.item.text;
      }
    } catch {
      if (line.length > 20) return line;
    }
  }
  return null;
}

async function executeWithResult(
  context: AgentRunContext,
  prompt: string,
  sandbox = sandboxArg(context.permission),
): Promise<AgentRunResult> {
  const result = await runProcess({
    command: codexBin(),
    args: ["exec", "--json", "-C", context.projectPath, "-s", sandbox, prompt],
    cwd: context.projectPath,
    timeoutMs: context.timeoutMs ?? CODEX_TIMEOUT_MS,
    signal: context.signal,
    onStdout: (chunk) => context.onLog(chunk),
    onStderr: (chunk) => context.onLog(chunk, { stream: "stderr" }),
  });

  const summary = extractCodexSummary(result.stdout) || result.stderr.trim() || "Codex 执行结束";
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    summary,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    aborted: result.aborted,
    signal: result.signal,
  };
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",

  async detect() {
    const command = codexBin();
    const result = await commandExists(command, ["--version"]);
    return {
      id: "codex",
      label: "Codex",
      available: result.available,
      command,
      version: result.available ? result.output || null : null,
      message: result.available ? "Codex CLI 可用" : "未找到 Codex CLI，请配置 MOSS_CODEX_BIN",
    };
  },

  async run(context) {
    return executeWithResult(context, buildRunPrompt(context));
  },

  async review(context) {
    // review 阶段始终使用 read-only sandbox，无论用户配置的权限级别
    // 因为审查不应修改文件，只读模式更安全
    return executeWithResult(context, buildReviewPrompt(context), "read-only");
  },
};
