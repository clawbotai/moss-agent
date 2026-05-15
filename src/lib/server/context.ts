import { createContextSnapshot, getTaskWithRelations } from "@/lib/server/db";
import type { MemoryMode, TaskStage, TaskWithRelations } from "@/lib/types";

const MAX_CONTEXT_CHARS = 12000;
const MAX_SECTION_CHARS = 2400;

export interface ContextPackage {
  policy: string;
  memoryMode: MemoryMode;
  content: string;
  tokenEstimate: number;
}

export interface ContextPackageOptions {
  stageId?: string | null;
  includeMessages?: boolean;
  extraInstruction?: string | null;
  task?: TaskWithRelations;
}

export function buildContextPackage(
  taskId: string,
  options: ContextPackageOptions = {},
): ContextPackage {
  const task = options.task ?? getTaskWithRelations(taskId);
  if (!task) throw new Error("任务不存在");

  const includeMessages = options.includeMessages ?? task.contextPolicy.includes("selectedMessages");
  const sections = [
    "# 任务上下文包",
    metadataSection(task),
    promptSection(task),
    parentContextSection(task, includeMessages),
    stagesSection(task.stages),
    reviewSection(task.stages),
    summarySection(task),
    messagesSection(task, includeMessages),
    memorySection(task.memoryMode),
    options.extraInstruction ? `## 本次补充指令\n${trimSection(options.extraInstruction)}` : "",
  ].filter(Boolean);

  const content = clamp(sections.join("\n\n"), MAX_CONTEXT_CHARS);
  const policy = includeMessages && !task.contextPolicy.includes("selectedMessages")
    ? `${task.contextPolicy}+selectedMessages`
    : task.contextPolicy;
  return {
    policy,
    memoryMode: task.memoryMode,
    content,
    tokenEstimate: estimateTokens(content),
  };
}

export function saveContextSnapshot(taskId: string, stageId: string | null, context: ContextPackage) {
  return createContextSnapshot({
    taskId,
    stageId,
    policy: context.policy,
    memoryMode: context.memoryMode,
    content: context.content,
    tokenEstimate: context.tokenEstimate,
  });
}

function metadataSection(task: TaskWithRelations) {
  return [
    "## 隔离策略",
    `任务 ID：${task.id}`,
    `父任务 ID：${task.parentTaskId || "无"}`,
    `记忆模式：${task.memoryMode}`,
    `上下文策略：${task.contextPolicy}`,
    "默认不携带完整聊天、完整日志或完整 stdout；只传递任务摘要、阶段摘要、审查结论和显式选择的消息。",
  ].join("\n");
}

function promptSection(task: TaskWithRelations) {
  return `## 用户原始需求\n${trimSection(task.prompt)}`;
}

function parentContextSection(task: TaskWithRelations, includeMessages: boolean) {
  if (!task.parentTaskId) return "";
  const parent = getTaskWithRelations(task.parentTaskId);
  if (!parent) {
    return [
      "## 父任务上下文",
      "父任务不存在或已被删除，仅保留派生关系标记。",
    ].join("\n");
  }

  return [
    "## 父任务上下文",
    `父任务：${parent.title}`,
    "此任务由父任务显式派生。这里只继承父任务摘要、阶段摘要、审查结论和显式选择的消息，不继承完整聊天或日志。",
    parent.summary ? `### 父任务交付摘要\n${trimSection(parent.summary)}` : "### 父任务交付摘要\n暂无交付摘要。",
    parentStagesSection(parent.stages),
    parentReviewSection(parent.stages),
    parentMessagesSection(parent, includeMessages),
  ].join("\n");
}

function stagesSection(stages: TaskStage[]) {
  const completed = stages
    .filter((stage) => stage.outputSummary)
    .map((stage, index) => `${index + 1}. ${stage.name}（${stage.agent}/${stage.role}）：${trimSection(stage.outputSummary || "")}`);

  return completed.length ? `## 阶段摘要\n${completed.join("\n")}` : "## 阶段摘要\n暂无阶段摘要。";
}

function reviewSection(stages: TaskStage[]) {
  const reviews = stages
    .filter((stage) => ["review", "audit"].includes(stage.role) && stage.outputSummary)
    .map((stage, index) => `${index + 1}. ${stage.name}：${trimSection(stage.outputSummary || "")}`);

  return reviews.length ? `## 审查结论\n${reviews.join("\n")}` : "## 审查结论\n暂无审查结论。";
}

function parentStagesSection(stages: TaskStage[]) {
  const completed = stages
    .filter((stage) => stage.outputSummary)
    .map((stage, index) => `${index + 1}. ${stage.name}：${trimSection(stage.outputSummary || "")}`);

  return completed.length ? `### 父任务阶段摘要\n${completed.join("\n")}` : "### 父任务阶段摘要\n暂无阶段摘要。";
}

function parentReviewSection(stages: TaskStage[]) {
  const reviews = stages
    .filter((stage) => ["review", "audit"].includes(stage.role) && stage.outputSummary)
    .map((stage, index) => `${index + 1}. ${stage.name}：${trimSection(stage.outputSummary || "")}`);

  return reviews.length ? `### 父任务审查结论\n${reviews.join("\n")}` : "### 父任务审查结论\n暂无审查结论。";
}

function parentMessagesSection(parent: TaskWithRelations, includeMessages: boolean) {
  const selected = parent.messages.filter((message) => includeMessages && message.includeInContext);
  if (!selected.length) {
    return "### 父任务消息\n未显式选择父任务消息进入上下文。";
  }

  return [
    "### 父任务消息",
    selected
      .map((message, index) => `${index + 1}. ${message.role}：${trimSection(message.content)}`)
      .join("\n"),
  ].join("\n");
}

function summarySection(task: TaskWithRelations) {
  return `## 交付摘要\n${task.summary ? trimSection(task.summary) : "暂无交付摘要。"}`;
}

function messagesSection(task: TaskWithRelations, includeMessages: boolean) {
  const selected = task.messages.filter((message) => includeMessages && message.includeInContext);
  if (!selected.length) {
    return "## 当前任务消息\n未显式选择消息进入上下文。";
  }

  return [
    "## 当前任务消息",
    selected
      .map((message, index) => `${index + 1}. ${message.role}：${trimSection(message.content)}`)
      .join("\n"),
  ].join("\n");
}

function memorySection(memoryMode: MemoryMode) {
  if (memoryMode === "off") {
    return "## 项目记忆\n已关闭。";
  }
  if (memoryMode === "projectMemory") {
    return "## 项目记忆\n项目级长期记忆已开启；当前版本仅保留策略标记，后续接入项目记忆库。";
  }
  return "## 项目记忆\n仅使用本任务压缩摘要。";
}

function trimSection(value: string) {
  return clamp(value.trim(), MAX_SECTION_CHARS);
}

function clamp(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[已截断，避免上下文过长]`;
}

function estimateTokens(value: string) {
  let cjk = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0xff00 && code <= 0xffef)    // Fullwidth Forms
    ) {
      cjk++;
    }
  }
  const ascii = value.length - cjk;
  return Math.ceil(ascii / 4 + cjk * 0.7);
}
