import { createContextSnapshot, getTaskWithRelations, getTaskDeriveOptions, getParentTaskId } from "@/lib/server/db";
import { searchProjectMemory } from "@/lib/server/memory";
import { generateChangeScope } from "@/lib/server/changes";
import type { ChangeScope } from "@/lib/server/changes";
import { DERIVE_OPTIONS_DEFAULTS } from "@/lib/types";
import type { DeriveOptions, MemoryMode, StageRole, TaskStage, TaskWithRelations } from "@/lib/types";

const MAX_CONTEXT_CHARS = 12000;

// ─── 阶段权重配置 ───────────────────────────────────────────

type WeightKey = "prompt" | "stages" | "review" | "changes" | "memory" | "parentContext" | "summary" | "messages";

const STAGE_WEIGHTS: Record<StageRole, Record<WeightKey, number>> = {
  plan:       { prompt: 0.4,  stages: 0.0,  review: 0.0,  changes: 0.0,  memory: 0.2,  parentContext: 0.2,  summary: 0.1,  messages: 0.1 },
  review:     { prompt: 0.15, stages: 0.25, review: 0.3,  changes: 0.0,  memory: 0.1,  parentContext: 0.0,  summary: 0.1,  messages: 0.1 },
  revise:     { prompt: 0.15, stages: 0.25, review: 0.3,  changes: 0.0,  memory: 0.1,  parentContext: 0.0,  summary: 0.1,  messages: 0.1 },
  implement:  { prompt: 0.2,  stages: 0.2,  review: 0.0,  changes: 0.15, memory: 0.15, parentContext: 0.1,  summary: 0.15, messages: 0.05 },
  audit:      { prompt: 0.15, stages: 0.2,  review: 0.0,  changes: 0.25, memory: 0.15, parentContext: 0.1,  summary: 0.1,  messages: 0.05 },
  summarize:  { prompt: 0.2,  stages: 0.4,  review: 0.0,  changes: 0.0,  memory: 0.1,  parentContext: 0.0,  summary: 0.2,  messages: 0.1 },
};

// ─── 公开接口 ───────────────────────────────────────────────

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

export async function buildContextPackage(
  taskId: string,
  options: ContextPackageOptions = {},
): Promise<ContextPackage> {
  const task = options.task ?? getTaskWithRelations(taskId);
  if (!task) throw new Error("任务不存在");

  // 确定当前阶段 role
  const stage = options.stageId ? task.stages.find((s) => s.id === options.stageId) : null;
  const role: StageRole = (stage?.role as StageRole) || "summarize";
  const weights = STAGE_WEIGHTS[role];

  // 计算各 section 配额
  const quotas = Object.fromEntries(
    Object.entries(weights).map(([key, weight]) => [key, Math.floor(MAX_CONTEXT_CHARS * weight)]),
  ) as Record<WeightKey, number>;

  // 变更范围（仅 implement/audit 阶段，且权重 > 0）
  let changeScopeContent = "";
  if (quotas.changes > 0 && task.project?.path) {
    const changeScope = await generateChangeScope(task.project.path);
    changeScopeContent = changesSection(changeScope, quotas.changes);
  }

  const includeMessages = options.includeMessages ?? task.contextPolicy.includes("selectedMessages");

  const sections = [
    "# 任务上下文包",
    metadataSection(task),
    promptSection(task, quotas.prompt),
    quotas.parentContext > 0 ? parentContextSection(task, includeMessages, quotas.parentContext) : "",
    quotas.stages > 0 ? stagesSection(task.stages, quotas.stages) : "",
    quotas.review > 0 ? reviewSection(task.stages, quotas.review) : "",
    quotas.summary > 0 ? summarySection(task, quotas.summary) : "",
    quotas.messages > 0 ? messagesSection(task, includeMessages, quotas.messages) : "",
    memorySection(task.memoryMode, task.projectId, task.prompt, quotas.memory),
    changeScopeContent,
    options.extraInstruction ? `## 本次补充指令\n${clamp(options.extraInstruction.trim(), 800)}` : "",
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

// ─── Section 函数 ────────────────────────────────────────────

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

function promptSection(task: TaskWithRelations, maxChars: number) {
  return `## 用户原始需求\n${clamp(task.prompt.trim(), maxChars)}`;
}

function parentContextSection(task: TaskWithRelations, includeMessages: boolean, maxChars: number): string {
  if (!task.parentTaskId) return "";
  
  const parent = getTaskWithRelations(task.parentTaskId);
  if (!parent) {
    return clamp("## 父任务上下文\n父任务不存在或已被删除，仅保留派生关系标记。", maxChars);
  }

  const options = getTaskDeriveOptions(task.id);
  
  // 检查派生深度，超过 3 层强制 minimal
  const depth = getDerivationDepth(task);
  const effectiveScope = depth > 3 ? "minimal" : options.contextScope;

  const sections: string[] = [
    "## 父任务上下文",
    `父任务：${parent.title}`,
    `上下文范围：${effectiveScope}`,
  ];

  // 根据 contextScope 确定内容丰富度
  if (effectiveScope === "minimal") {
    // minimal：只有标题和一行摘要
    if (parent.summary) {
      sections.push(`摘要：${parent.summary.slice(0, 200)}`);
    }
    return clamp(sections.join("\n"), maxChars);
  }

  // standard/full：包含父任务交付摘要
  if (options.includeParentSummary) {
    sections.push(`### 父任务交付摘要\n${parent.summary || "暂无交付摘要。"}`);
  }

  // 控制继承哪些阶段
  let stagesToInclude = parent.stages.filter(s => s.status === "completed" && s.outputSummary);
  if (options.inheritStages === "lastN" || typeof options.inheritStages === "number") {
    const n = typeof options.inheritStages === "number" ? options.inheritStages : 1;
    stagesToInclude = stagesToInclude.slice(-n);
  }
  // "completed" 保持全部已完成阶段

  if (stagesToInclude.length) {
    sections.push(`### 继承的阶段摘要\n${stagesToInclude.map((s, i) =>
      `${i + 1}. ${s.name}（${s.agent}/${s.role}）：${s.outputSummary?.slice(0, 300) || ""}`
    ).join("\n")}`);
  }

  // 消息继承
  if (options.inheritMessages && includeMessages) {
    const selected = parent.messages.filter(m => m.includeInContext);
    if (selected.length) {
      sections.push(`### 继承的消息\n${selected.map((m, i) =>
        `${i + 1}. ${m.role}：${m.content.slice(0, 200)}`
      ).join("\n")}`);
    }
  }

  // full scope 额外包含审查结论
  if (effectiveScope === "full") {
    const reviews = parent.stages.filter(s => (s.role === "review" || s.role === "audit") && s.outputSummary);
    if (reviews.length) {
      sections.push(`### 父任务审查结论\n${reviews.map((s, i) =>
        `${i + 1}. ${s.name}：${s.outputSummary?.slice(0, 300) || ""}`
      ).join("\n")}`);
    }
  }

  return clamp(sections.join("\n\n"), maxChars);
}

// 计算派生深度（轻量查询，只取 parentTaskId）
function getDerivationDepth(task: TaskWithRelations): number {
  let depth = 0;
  let currentParentId = task.parentTaskId;
  const visited = new Set<string>();

  while (currentParentId && depth < 10) {
    if (visited.has(currentParentId)) break; // 防循环
    visited.add(currentParentId);
    const parentId = getParentTaskId(currentParentId);
    depth++;
    currentParentId = parentId;
  }

  return depth;
}

function stagesSection(stages: TaskStage[], maxChars: number) {
  const completed = stages
    .filter((stage) => !isSkippedContextStage(stage) && stage.outputSummary)
    .map((stage, index) => `${index + 1}. ${stage.name}（${stage.agent}/${stage.role}）：${stage.outputSummary || ""}`);

  const content = completed.length ? `## 阶段摘要\n${completed.join("\n")}` : "## 阶段摘要\n暂无阶段摘要。";
  return clamp(content, maxChars);
}

function reviewSection(stages: TaskStage[], maxChars: number) {
  const reviews = stages
    .filter((stage) => (stage.role === "review" || stage.role === "audit") && stage.outputSummary)
    .map((stage, index) => `${index + 1}. ${stage.name}：${stage.outputSummary || ""}`);

  const content = reviews.length ? `## 审查/审核结论\n${reviews.join("\n")}` : "## 审查/审核结论\n暂无审查结论。";
  return clamp(content, maxChars);
}

function changesSection(changeScope: ChangeScope | null, maxChars: number): string {
  if (!changeScope) return "";

  const lines = [
    "## 变更范围",
    `概览：${changeScope.summary}`,
    "",
    "关键文件：",
    ...changeScope.keyFiles.map((f) => `- ${f}`),
  ];

  if (changeScope.diffStat) {
    lines.push("", "Diff 统计：", changeScope.diffStat);
  }

  return clamp(lines.join("\n"), maxChars);
}

function summarySection(task: TaskWithRelations, maxChars: number) {
  const content = `## 交付摘要\n${task.summary ? task.summary.trim() : "暂无交付摘要。"}`;
  return clamp(content, maxChars);
}

function messagesSection(task: TaskWithRelations, includeMessages: boolean, maxChars: number) {
  const selected = task.messages.filter((message) => includeMessages && message.includeInContext);
  if (!selected.length) {
    return "## 当前任务消息\n未显式选择消息进入上下文。";
  }

  const content = [
    "## 当前任务消息",
    selected
      .map((message, index) => `${index + 1}. ${message.role}：${message.content}`)
      .join("\n"),
  ].join("\n");

  return clamp(content, maxChars);
}

function memorySection(memoryMode: MemoryMode, projectId: string, taskPrompt: string, maxChars: number): string {
  if (memoryMode === "off") return "## 项目记忆\n已关闭。";

  if (memoryMode === "projectMemory") {
    const relevant = searchProjectMemory(projectId, {
      categories: ["architecture", "decision", "convention", "issue"],
      limit: 5,
    });

    if (!relevant.length) return "## 项目记忆\n已开启，当前无相关记忆。";

    const items = relevant.map((m) =>
      `### [${m.category}] ${m.source === "auto" ? `(来自任务 ${m.taskId})` : "(手动)"}\n${m.content}`,
    );
    return clamp(`## 项目记忆\n${items.join("\n\n")}`, maxChars);
  }

  return "## 项目记忆\n仅使用本任务压缩摘要。";
}

// ─── 工具函数 ────────────────────────────────────────────────

function isSkippedContextStage(stage: TaskStage) {
  return stage.role === "audit" || stage.role === "summarize";
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
