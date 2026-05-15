import type { TaskLog, TaskMessage, TaskStage, TaskWithRelations } from "@/lib/types";
import type {
  AnswerEntry,
  CollaborationEntry,
  ConversationQuestion,
  ConversationTurn,
  DerivedLogKind,
} from "./types";

export function isKeyLog(log: TaskLog) {
  if (log.level === "warn" || log.level === "error") return true;
  return /任务开始|任务完成|阶段开始|阶段完成|可能卡住|取消|重试|切换|无法执行|执行失败/.test(log.message);
}

export function stageFallbackText(stage: TaskStage) {
  if (stage.status === "running") return "正在执行，等待 agent 输出。";
  if (stage.status === "completed") return "阶段已完成，暂无摘要。";
  if (stage.status === "failed") return "阶段执行失败，暂无详细摘要。";
  return "等待执行。";
}

export function deriveLogKind(log: TaskLog): DerivedLogKind {
  if (log.level === "error") return "error";
  if (log.level === "warn") return "warning";
  return isKeyLog(log) ? "event" : "agent-output";
}

export function deriveLogLabel(log: TaskLog) {
  const kind = deriveLogKind(log);
  if (kind === "error") return "错误";
  if (kind === "warning") return "警告";
  if (kind === "event") return "事件";
  return "输出";
}

export function formatDuration(startedAt: Date, finishedAt: Date) {
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${restSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function getVisibleStages(stages: TaskStage[]): TaskStage[] {
  if (stages.length === 0) return [];

  let lastActiveIndex = -1;
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].status !== "queued") {
      lastActiveIndex = i;
      break;
    }
  }

  if (lastActiveIndex === -1) return [];

  return stages.slice(0, lastActiveIndex + 1);
}

export function buildConversationTurns(task: TaskWithRelations): ConversationTurn[] {
  const taskCreatedAt = toTime(task.createdAt);
  const questions: ConversationQuestion[] = [
    {
      key: "prompt",
      content: task.prompt,
      createdAt: task.createdAt,
    },
    ...task.messages
      .filter((message) => message.role === "user")
      .map((message) => ({
        key: `message-${message.id}`,
        content: message.content,
        createdAt: message.createdAt,
        includeInContext: message.includeInContext,
      })),
  ].sort((left, right) => {
    const leftAt = toTime(left.createdAt);
    const rightAt = toTime(right.createdAt);
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.key.localeCompare(right.key);
  });

  const collaboration = buildCollaborationEntries(task);
  const answers = buildAnswerEntries(task);

  return questions.map((question, index) => {
    const startAt = toTime(question.createdAt);
    const nextQuestionAt = index < questions.length - 1 ? toTime(questions[index + 1].createdAt) : Number.POSITIVE_INFINITY;
    const normalizedStartAt = Number.isFinite(startAt) ? startAt : taskCreatedAt;

    return {
      key: question.key,
      question,
      collaboration: sliceByTime(collaboration, normalizedStartAt, nextQuestionAt, taskCreatedAt),
      answers: sliceByTime(answers, normalizedStartAt, nextQuestionAt, taskCreatedAt),
    };
  });
}

function sliceByTime<Entry extends { at: number }>(
  sortedEntries: Entry[],
  startAt: number,
  nextQuestionAt: number,
  fallbackAt: number,
): Entry[] {
  const lo = lowerBound(sortedEntries, startAt, fallbackAt);
  const hi = lowerBound(sortedEntries, nextQuestionAt, fallbackAt);
  return sortedEntries.slice(lo, hi);
}

function lowerBound<Entry extends { at: number }>(sortedEntries: Entry[], target: number, fallbackAt: number): number {
  let lo = 0;
  let hi = sortedEntries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midAt = Number.isFinite(sortedEntries[mid].at) ? sortedEntries[mid].at : fallbackAt;
    if (midAt < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function buildCollaborationEntries(task: TaskWithRelations): CollaborationEntry[] {
  const taskCreatedAt = toTime(task.createdAt);
  const entries: CollaborationEntry[] = [];
  const stageErrorMessages = new Set(task.stages.map((stage) => stage.errorMessage).filter(Boolean));
  const terminalAt = toTime(task.completedAt || task.updatedAt || task.createdAt);
  const terminalOrder = task.stages.length * 10 + 100;

  for (const stage of getVisibleStages(task.stages)) {
    entries.push({
      type: "stage",
      key: `stage-${stage.id}`,
      at: toTime(stage.startedAt || stage.completedAt || task.createdAt),
      order: stage.orderIndex * 10,
      stage,
    });
  }

  task.messages.forEach((message, index) => {
    if (message.role === "user" || message.role === "agent") return;
    entries.push({
      type: "message",
      key: `message-${message.id}`,
      at: toTime(message.createdAt),
      order: task.stages.length * 10 + 200 + index,
      message,
    });
  });

  if (task.errorMessage && !stageErrorMessages.has(task.errorMessage)) {
    entries.push({
      type: "error",
      key: "task-error",
      at: terminalAt,
      order: terminalOrder,
      errorMessage: task.errorMessage,
      status: task.status,
    });
  }

  return sortTimedEntries(entries, taskCreatedAt);
}

function buildAnswerEntries(task: TaskWithRelations): AnswerEntry[] {
  const taskCreatedAt = toTime(task.createdAt);
  const terminalAt = toTime(task.completedAt || task.updatedAt || task.createdAt);
  const terminalOrder = task.stages.length * 10 + 100;
  const entries: AnswerEntry[] = [];

  task.messages.forEach((message, index) => {
    if (message.role !== "agent") return;
    entries.push({
      type: "message",
      key: `answer-${message.id}`,
      at: toTime(message.createdAt),
      order: task.stages.length * 10 + 300 + index,
      message,
    });
  });

  if (task.summary) {
    entries.push({
      type: "summary",
      key: "task-summary",
      at: terminalAt,
      order: terminalOrder + 1,
      summary: task.summary,
    });
  }

  return sortTimedEntries(entries, taskCreatedAt);
}

function sortTimedEntries<Entry extends CollaborationEntry | AnswerEntry>(entries: Entry[], fallbackAt: number): Entry[] {
  return [...entries].sort((left, right) => {
    const leftAt = Number.isFinite(left.at) ? left.at : fallbackAt;
    const rightAt = Number.isFinite(right.at) ? right.at : fallbackAt;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.order - right.order;
  });
}

function toTime(value: string | null) {
  return value ? new Date(value).getTime() : Number.NaN;
}

export function messageRoleLabel(role: TaskMessage["role"]) {
  if (role === "user") return "用户";
  if (role === "system") return "系统";
  return "Agent";
}
