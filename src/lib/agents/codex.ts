import type { AgentAdapter, AgentRunContext } from "@/lib/agents/types";
import { commandExists, runProcess } from "@/lib/agents/process";

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
    const prompt = [
      "你是协作调度平台中的 Codex 开发 agent。",
      budgetInstruction(context.budget),
      "请在当前项目目录完成任务，完成后输出变更摘要、验证结果和剩余风险。",
      "",
      context.prompt,
    ].join("\n");

    const result = await runProcess({
      command: codexBin(),
      args: ["exec", "--json", "-C", context.projectPath, "-s", sandboxArg(context.permission), prompt],
      cwd: context.projectPath,
      signal: context.signal,
      onStdout: (chunk) => context.onLog(chunk),
      onStderr: (chunk) => context.onLog(chunk, { stream: "stderr" }),
    });

    const summary = extractCodexSummary(result.stdout) || result.stderr || "Codex 执行结束";
    return { ok: result.exitCode === 0, summary, exitCode: result.exitCode };
  },

  async review(context) {
    const prompt = [
      "你是协作调度平台中的 Codex 审查 agent。",
      "请审查给定计划或当前未提交变更，优先指出阻塞问题、风险和缺失测试。",
      "只进行审查，不要修改文件；如果需要审查代码变更，请先读取 git status 和 git diff。",
      budgetInstruction(context.budget),
      "",
      context.prompt,
    ].join("\n");

    const result = await runProcess({
      command: codexBin(),
      args: ["exec", "--json", "-C", context.projectPath, "-s", "read-only", prompt],
      cwd: context.projectPath,
      signal: context.signal,
      onStdout: (chunk) => context.onLog(chunk),
      onStderr: (chunk) => context.onLog(chunk, { stream: "stderr" }),
    });

    const summary = extractCodexSummary(result.stdout) || result.stderr.trim() || "Codex 审查结束";
    return { ok: result.exitCode === 0, summary, exitCode: result.exitCode };
  },
};

function extractCodexSummary(stdout: string) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const event = JSON.parse(line) as { type?: string; message?: string; content?: string };
      if (event.message) return event.message;
      if (event.content) return event.content;
    } catch {
      if (line.length > 20) return line;
    }
  }
  return null;
}
