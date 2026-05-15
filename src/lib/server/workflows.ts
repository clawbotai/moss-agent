import type { AgentId, Task, TaskStage } from "@/lib/types";

type StageSeed = Omit<TaskStage, "id" | "taskId">;

export function buildWorkflow(task: Task): StageSeed[] {
  if (task.mode === "codexOnly") {
    return [
      stage("Codex 直接开发", "codex", "implement", 0),
    ];
  }

  if (task.mode === "claudeOnly") {
    return [
      stage("Claude Code 直接开发", "claude", "implement", 0),
    ];
  }

  if (task.mode === "custom") {
    return [
      stage("自定义 agent 执行", task.targetAgent || "custom", "implement", 0),
    ];
  }

  return [
    stage("Claude Code 生成计划", "claude", "plan", 0),
    stage("Codex 审查计划", "codex", "review", 1),
    stage("Claude Code 修订计划", "claude", "revise", 2),
    stage("Codex 执行开发", "codex", "implement", 3),
    stage("Claude Code 审核结果", "claude", "audit", 4),
  ];
}

function stage(
  name: string,
  agent: AgentId,
  role: StageSeed["role"],
  orderIndex: number,
): StageSeed {
  return {
    name,
    agent,
    role,
    status: "queued",
    inputSummary: null,
    outputSummary: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    orderIndex,
  };
}

export function buildStagePrompt(
  task: Task,
  stage: TaskStage,
  previousSummaries: string[],
  contextPackage: string,
) {
  const context = previousSummaries.length
    ? `已有阶段摘要：\n${previousSummaries.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
    : "当前没有已有阶段摘要。";

  const base = [
    `任务：${task.title}`,
    contextPackage,
    context,
    "",
  ].join("\n");

  if (stage.role === "plan") {
    return `${base}请输出可执行实施计划，包含目标、关键变更、风险和验证方式。`;
  }

  if (stage.role === "review") {
    return `${base}请审查上一步计划，输出阻塞问题、风险、缺失信息和建议修改。`;
  }

  if (stage.role === "revise") {
    return `${base}请根据审查意见修订计划，输出最终可执行版本。`;
  }

  if (stage.role === "implement") {
    return `${base}请按最终计划完成实现，并在结束时输出变更摘要、验证结果和剩余风险。`;
  }

  if (stage.role === "audit") {
    return `${base}请审核当前结果，重点检查功能完整性、风险、测试缺口和交付是否可接受。请以面向用户的 Moss 回答形式输出最终结论，不要重复阶段名称。请控制在 500 字以内，使用 Markdown 格式。`;
  }

  return `${base}请按当前阶段职责完成任务，并输出必要结果。`;
}
