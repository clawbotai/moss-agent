import { detectConfirmationRequest, sanitizeConfirmationRequest } from "../src/lib/agents/confirmation-detect";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function testExplicitConfirmation() {
  const result = detectConfirmationRequest([
    "[CONFIRM] 请选择要继续的方向",
    "[OPTIONS] 扩写正文 | 创建项目文件 | 只润色",
    "[DEFAULT] 1",
  ].join("\n"));

  assert(result, "显式确认请求应被识别");
  assert(result.question === "请选择要继续的方向", "显式确认问题应被识别");
  assert(result.options?.length === 3, "显式确认选项应被识别");
  assert(result.defaultOption === 1, "默认选项应被识别");
}

function testRejectCodexCommandEvent() {
  const event = JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_2",
      type: "command_execution",
      command: "/bin/zsh -lc \"sed -n '221,520p' writer/SKILL.md\"",
      aggregated_output: [
        "### 5. 单场景闭环",
        "",
        "> [场景结束，是否进入下一场景？]",
        "",
        "### 7. 输出格式",
        "",
        "```markdown",
        "### 精修前（用户原文）",
        "```",
      ].join("\n"),
      exit_code: 0,
      status: "completed",
    },
  });

  const result = detectConfirmationRequest(event);
  assert(!result, "Codex command_execution 事件不应触发确认请求");
}

function testRejectPersistedBadQuestion() {
  const result = sanitizeConfirmationRequest({
    question: "{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"aggregated_output\":\"```markdown\"}}",
    options: ["继续", "取消"],
    rawOutput: "{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\"}}",
  });

  assert(!result, "已持久化的异常 JSON 问题不应继续展示给 UI");
}

function main() {
  testExplicitConfirmation();
  testRejectCodexCommandEvent();
  testRejectPersistedBadQuestion();
  console.log("confirmation-detect tests passed");
}

main();
