import assert from "node:assert/strict";
import { detectConfirmationRequest } from "../src/lib/agents/confirmation";

function testExplicitOptions() {
  const output = `
我发现了两种实现方式：

[CONFIRM] 请选择实现方式
[OPTIONS] 使用 React Context 管理状态 | 使用 Redux 管理状态 | 使用 Zustand 管理状态
[DEFAULT] 0

请选择后继续。
`;

  const result = detectConfirmationRequest(output);
  assert.equal(result?.question, "请选择实现方式");
  assert.deepEqual(result?.options, [
    "使用 React Context 管理状态",
    "使用 Redux 管理状态",
    "使用 Zustand 管理状态",
  ]);
  assert.equal(result?.defaultOption, 0);
}

function testExplicitFreeText() {
  const output = `
需求描述不够明确。

[CONFIRM] 请详细说明"用户权限"的具体含义：是指功能权限还是数据权限？
`;

  const result = detectConfirmationRequest(output);
  assert.ok(result?.question.includes("用户权限"));
  assert.equal(result?.options, undefined);
}

function testNoConfirmation() {
  const output = `
任务已完成，代码已提交。
`;

  assert.equal(detectConfirmationRequest(output), undefined);
}

function testSmartQFormat() {
  const output = `
在深入方案设计之前，我需要先和你对齐几个关键问题：

**Q1：你说的「skill 调用」具体指哪种场景？**
- **A)** 在任务流程中调用 Claude Code 已有的 Skill 工具
- **B)** 在 moss-agent 平台内构建自有的 skill 注册/调度系统
- **C)** 两者都要 - 先集成已有能力，再设计可扩展框架

请告诉我你的选择。
`;

  const result = detectConfirmationRequest(output);
  assert.ok(result?.question.includes("skill 调用"));
  assert.equal(result?.options?.length, 3);
}

function testDirectOptionsDoNotFalsePositive() {
  const output = `
需求不明确，请选择实现方式：
(A) 使用 React Context
(B) 使用 Redux
(C) 使用 Zustand
`;

  assert.equal(detectConfirmationRequest(output), undefined);
}

function testSmartNumberedQuestionWithIntent() {
  const output = `
在给出方案前，需要明确以下边界：

**1. 你的核心场景是什么？**
- **A)** 用户在 Composer 输入触发特定能力
- **B)** Agent 在执行过程中自动发现并调用合适的 skill
- **C)** 任务流程中某个阶段固定调用特定 skill

请回答上面的问题，我再给出详细的实施计划。
`;

  const result = detectConfirmationRequest(output);
  assert.ok(result?.question.includes("核心场景"));
  assert.equal(result?.options?.length, 3);
}

function testSmartDetectionNoIntentKeywords() {
  const output = `
以下是性能优化建议：

1. 为什么缓存命中率低？
- 数据访问模式不均匀
- 缓存策略配置不当

2. 如何减少 GC 压力？
- 减少对象创建频率
- 使用对象池模式

这些都是常见问题，可以逐步解决。
`;

  assert.equal(detectConfirmationRequest(output), undefined);
}

function testCodexJsonOutput() {
  const output = [
    JSON.stringify({ type: "session.created", message: "started" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "[CONFIRM] 请选择实现方式\n[OPTIONS] 方案 A | 方案 B\n[DEFAULT] 1",
      },
    }),
  ].join("\n");

  const result = detectConfirmationRequest(output);
  assert.equal(result?.question, "请选择实现方式");
  assert.deepEqual(result?.options, ["方案 A", "方案 B"]);
  assert.equal(result?.defaultOption, 1);
}

function testExplicitMultipleOptions() {
  const output = `
[CONFIRM] 请回答以上 4 个问题，以便我确定方案边界
[OPTIONS] Q1: A) 透传调用 | B) 平台级调度 | C) 自建 skill 系统
[OPTIONS] Q2: A) 用户手动 | B) Agent 自动 | C) 流程绑定
[OPTIONS] Q3: 是，复用现有机制 | 否，需要独立处理
[OPTIONS] Q4: A) 最小可用 | B) 标准版 | C) 完整版
[DEFAULT] 0
`;

  const result = detectConfirmationRequest(output);
  assert.equal(result?.question, "请回答以上 4 个问题，以便我确定方案边界");
  assert.equal(result?.options?.length, 11);
  assert.ok(result?.options?.[0].includes("Q1"));
  assert.ok(result?.options?.[3].includes("Q2"));
  assert.equal(result?.defaultOption, 0);
  assert.ok(result?.rawOutput && result.rawOutput.length > 0);
}

function testRawOutputPresent() {
  const output = "some agent output\n[CONFIRM] test question\n[OPTIONS] A | B";
  const result = detectConfirmationRequest(output);
  assert.equal(result?.rawOutput, output);
}

function main() {
  testExplicitOptions();
  testExplicitFreeText();
  testNoConfirmation();
  testSmartQFormat();
  testDirectOptionsDoNotFalsePositive();
  testSmartNumberedQuestionWithIntent();
  testSmartDetectionNoIntentKeywords();
  testCodexJsonOutput();
  testExplicitMultipleOptions();
  testRawOutputPresent();
  console.log("确认请求检测测试通过");
}

main();
