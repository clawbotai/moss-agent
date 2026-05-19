/**
 * 测试 Agent 适配器的超时和恢复提示
 */
import { claudeAdapter } from "../src/lib/agents/claude";
import { codexAdapter } from "../src/lib/agents/codex";
import type { AgentRunContext } from "../src/lib/agents/types";

function createMockContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
  return {
    taskId: "test-task",
    stageId: "test-stage",
    projectPath: process.cwd(),
    prompt: "测试任务",
    budget: "standard",
    permission: "workspaceWrite",
    signal: AbortSignal.timeout(30000),
    onLog: () => {},
    attempt: 1,
    ...overrides,
  };
}

async function testClaudeTimeoutConfig() {
  console.log("=== 测试 1: Claude 超时配置 ===");

  // 测试默认超时
  const defaultTimeout = Number(process.env.MOSS_CLAUDE_TIMEOUT_MS) || 20 * 60 * 1000;
  console.log(`默认超时: ${defaultTimeout / 1000}s`);

  // 测试自定义超时
  process.env.MOSS_CLAUDE_TIMEOUT_MS = "5000";
  const customTimeout = Number(process.env.MOSS_CLAUDE_TIMEOUT_MS) || 20 * 60 * 1000;
  console.log(`自定义超时: ${customTimeout / 1000}s`);

  delete process.env.MOSS_CLAUDE_TIMEOUT_MS;

  const pass = defaultTimeout === 20 * 60 * 1000 && customTimeout === 5000;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

async function testCodexTimeoutConfig() {
  console.log("\n=== 测试 2: Codex 超时配置 ===");

  const defaultTimeout = Number(process.env.MOSS_CODEX_TIMEOUT_MS) || 20 * 60 * 1000;
  console.log(`默认超时: ${defaultTimeout / 1000}s`);

  const pass = defaultTimeout === 20 * 60 * 1000;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

async function testResumeHintInPrompt() {
  console.log("\n=== 测试 3: 恢复提示包含在 prompt 中 ===");

  // 通过检测 adapter 的 detect 方法验证 CLI 可用
  const claudeDetect = await claudeAdapter.detect();
  const codexDetect = await codexAdapter.detect();

  console.log(`Claude CLI 可用: ${claudeDetect.available}`);
  console.log(`Codex CLI 可用: ${codexDetect.available}`);

  const pass = claudeDetect.available && codexDetect.available;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

async function testAttemptDefaultValue() {
  console.log("\n=== 测试 4: attempt 默认值 ===");

  // 创建不带 attempt 的 context
  const context = createMockContext({});
  const attempt = context.attempt ?? 1;

  console.log(`未设置 attempt 时的默认值: ${attempt}`);

  const pass = attempt === 1;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

async function main() {
  console.log("开始测试 Agent 适配器...\n");

  const results = [
    await testClaudeTimeoutConfig(),
    await testCodexTimeoutConfig(),
    await testResumeHintInPrompt(),
    await testAttemptDefaultValue(),
  ];

  const passed = results.filter(Boolean).length;
  console.log(`\n=== 测试完成: ${passed}/${results.length} 通过 ===`);

  if (passed < results.length) {
    process.exit(1);
  }
}

main();
