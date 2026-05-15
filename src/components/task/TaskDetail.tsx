"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CircleStop,
  Code2,
  Copy,
  MessageSquareText,
  Play,
  RotateCcw,
  TerminalSquare,
  User,
} from "lucide-react";
import { useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskLog, TaskMessage, TaskStage, TaskWithRelations } from "@/lib/types";
import { statusLabel } from "@/components/common/StatusDot";

interface TaskDetailProps {
  task: TaskWithRelations | null;
  onCancel: () => void;
  onRetry: () => void;
  onContinue: () => void;
  onSwitch: (agent: "claude" | "codex") => void;
}

type DerivedLogKind = "event" | "agent-output" | "warning" | "error";

type ConversationQuestion = {
  key: string;
  content: string;
  createdAt: string;
  includeInContext?: boolean;
};

type CollaborationEntry =
  | {
      type: "stage";
      key: string;
      at: number;
      order: number;
      stage: TaskStage;
    }
  | {
      type: "message";
      key: string;
      at: number;
      order: number;
      message: TaskMessage;
    }
  | {
      type: "error";
      key: string;
      at: number;
      order: number;
      errorMessage: string;
      status: string;
    };

type AnswerEntry =
  | {
      type: "summary";
      key: string;
      at: number;
      order: number;
      summary: string;
    }
  | {
      type: "message";
      key: string;
      at: number;
      order: number;
      message: TaskMessage;
    };

type ConversationTurn = {
  key: string;
  question: ConversationQuestion;
  collaboration: CollaborationEntry[];
  answers: AnswerEntry[];
};

const VALID_STAGE_STATUSES = new Set(["queued", "running", "completed", "failed", "waiting", "skipped", "cancelled"]);

export function TaskDetail({ task, onCancel, onRetry, onContinue, onSwitch }: TaskDetailProps) {
  const logsByStage = useMemo(() => {
    const map = new Map<string, TaskLog[]>();
    if (!task) return map;
    for (const log of task.logs) {
      if (!log.stageId) continue;
      const current = map.get(log.stageId) || [];
      current.push(log);
      map.set(log.stageId, current);
    }
    return map;
  }, [task]);

  const taskLevelLogs = useMemo(() => {
    if (!task) return [];
    return task.logs.filter((log) => !log.stageId);
  }, [task]);

  const conversationTurns = useMemo(() => {
    if (!task) return [];
    return buildConversationTurns(task);
  }, [task]);

  if (!task) return null;

  const cancellable = ["queued", "running", "stuck"].includes(task.status);
  const retryable = !["queued", "running"].includes(task.status);
  const switchable = task.status === "stuck" || retryable;

  return (
    <section className="detailPanel taskRunView fade-in">
      <div className="detailHeader runHeader">
        <div>
          <span className="eyebrow">{statusLabel(task.status)}</span>
          <h2>{task.title}</h2>
          <p>{task.project?.path}</p>
        </div>
        <div className="actionRow">
          <button disabled={task.status !== "stuck"} onClick={onContinue} type="button">
            <Play size={15} />
            继续等待
          </button>
          <button disabled={!cancellable} onClick={onCancel} type="button">
            <CircleStop size={15} />
            取消
          </button>
          <button disabled={!retryable} onClick={onRetry} type="button">
            <RotateCcw size={15} />
            重试
          </button>
          <button disabled={!switchable} onClick={() => onSwitch("codex")} type="button">
            <Bot size={15} />
            改用 Codex
          </button>
          <button disabled={!switchable} onClick={() => onSwitch("claude")} type="button">
            <Bot size={15} />
            改用 Claude
          </button>
        </div>
      </div>

      <div className="timelineStream">
        {conversationTurns.map((turn) => (
          <ConversationTurnView key={turn.key} turn={turn} logsByStage={logsByStage} />
        ))}

        {taskLevelLogs.length > 0 && <TimelineDebugLogs logs={taskLevelLogs} />}
      </div>
    </section>
  );
}

function ConversationTurnView({
  turn,
  logsByStage,
}: {
  turn: ConversationTurn;
  logsByStage: Map<string, TaskLog[]>;
}) {
  return (
    <div className="tlConversation">
      <TimelinePrompt
        prompt={turn.question.content}
        createdAt={turn.question.createdAt}
        includeInContext={turn.question.includeInContext}
      />
      {turn.collaboration.map((entry) => (
        <TimelineCollaborationEntry key={entry.key} entry={entry} logsByStage={logsByStage} />
      ))}
      {turn.answers.map((answer) => {
        if (answer.type === "message") {
          return <TimelineMossMessage key={answer.key} message={answer.message} />;
        }
        return <TimelineSummary key={answer.key} summary={answer.summary} />;
      })}
    </div>
  );
}

function TimelinePrompt({
  prompt,
  createdAt,
  includeInContext,
}: {
  prompt: string;
  createdAt: string;
  includeInContext?: boolean;
}) {
  return (
    <div className="tlItem tlPrompt">
      <div className="tlDot">
        <User size={14} />
      </div>
      <div className="tlContent">
        <div className="tlHead tlMessageHead">
          <strong>用户</strong>
          <time>{new Date(createdAt).toLocaleString()}</time>
          {includeInContext && <span className="tlContextBadge">进入上下文</span>}
        </div>
        <div className="tlCard tlUserCard">
          <p className="tlPromptText">{prompt}</p>
        </div>
      </div>
    </div>
  );
}

function TimelineMossMessage({ message }: { message: TaskWithRelations["messages"][number] }) {
  return (
    <div className="tlItem tlMessages tlMossMessage">
      <div className="tlDot">
        <MessageSquareText size={14} />
      </div>
      <div className="tlContent">
        <div className="tlHead tlMessageHead">
          <strong>Moss</strong>
          <time>{new Date(message.createdAt).toLocaleString()}</time>
        </div>
        <div className="tlCard tlDeliveryCard">
          <MarkdownBlock content={message.content} className="inlineSummary" />
        </div>
      </div>
    </div>
  );
}

function TimelineCollaborationEntry({
  entry,
  logsByStage,
}: {
  entry: CollaborationEntry;
  logsByStage: Map<string, TaskLog[]>;
}) {
  if (entry.type === "stage") {
    return (
      <TimelineStage
        stage={entry.stage}
        logs={logsByStage.get(entry.stage.id) || []}
      />
    );
  }

  if (entry.type === "message") {
    return <TimelineInternalMessage message={entry.message} />;
  }

  return <TimelineError errorMessage={entry.errorMessage} status={entry.status} />;
}

function TimelineInternalMessage({ message }: { message: TaskWithRelations["messages"][number] }) {
  return (
    <div className="tlItem tlInternalMessage">
      <div className="tlDot">
        <MessageSquareText size={14} />
      </div>
      <div className="tlContent">
        <details className="tlStageShell">
          <summary className="tlStageSummary">
            <span className="tlStageTitle">
              <MessageSquareText size={14} />
              {messageRoleLabel(message.role)}
            </span>
            <time>{new Date(message.createdAt).toLocaleString()}</time>
            <ChevronDown className="tlChevron" size={14} />
          </summary>
          <div className="tlStageBody">
            <p className="tlPromptText">{message.content}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

function TimelineStage({
  stage,
  logs,
}: {
  stage: TaskStage;
  logs: TaskLog[];
}) {
  const started = stage.startedAt ? new Date(stage.startedAt) : null;
  const completed = stage.completedAt ? new Date(stage.completedAt) : null;
  const duration = started ? formatDuration(started, completed || new Date()) : null;
  const status = stage.status === "completed" ? "DONE" : statusLabel(stage.status);
  const isRunning = stage.status === "running";
  const isFailed = stage.status === "failed";
  let keyLog: TaskLog | undefined;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (isKeyLog(logs[i])) { keyLog = logs[i]; break; }
  }
  const displayText = stage.outputSummary || keyLog?.message || stage.errorMessage || "";
  const showBody = Boolean(displayText || stage.status === "running" || stage.status === "completed" || stage.status === "failed");

  return (
    <div className={`tlItem tlStage ${isRunning ? "tlRunning" : ""} ${isFailed ? "tlFailed" : ""}`}>
      <div className={`tlDot ${isRunning ? "tlDotPulse" : ""}`}>
        <Code2 size={14} />
      </div>
      <div className="tlContent">
        <details className="tlStageShell">
          <summary className="tlStageSummary">
            <span className="tlStageTitle">
              <Code2 size={14} />
              {stage.name}
            </span>
            <span className="tlMeta">{stage.agent} / {stage.role}</span>
            {duration && (
              <span className="tlDuration">
                <Clock3 size={12} />
                {duration}
              </span>
            )}
            <span className={`tlStatus tlStatus-${VALID_STAGE_STATUSES.has(stage.status) ? stage.status : "queued"}`}>{status}</span>
            <ChevronDown className="tlChevron" size={14} />
          </summary>
          <div className="tlStageBody">
          {showBody && (
            <div className="tlStageText">
              {displayText ? <MarkdownBlock content={displayText} /> : <p>{stageFallbackText(stage)}</p>}
            </div>
          )}
          {(stage.inputSummary || logs.length > 0) && (
            <details className="tlDebugDetails">
              <summary>
                <TerminalSquare size={13} />
                调试详情
                {logs.length > 0 && <span>{logs.length} 条日志</span>}
              </summary>
              {stage.inputSummary && (
                <div className="tlDebugBlock">
                  <strong>输入摘要</strong>
                  <pre>{stage.inputSummary}</pre>
                </div>
              )}
              {logs.length > 0 && <LogList logs={logs} />}
            </details>
          )}
          {stage.errorMessage && (
            <div className="inlineWarning">
              <strong>{stage.errorMessage}</strong>
            </div>
          )}
          </div>
        </details>
      </div>
    </div>
  );
}

function TimelineError({
  errorMessage,
  status,
}: {
  errorMessage: string;
  status: string;
}) {
  return (
    <div className="tlItem tlError">
      <div className="tlDot tlDotWarn">
        <AlertTriangle size={14} />
      </div>
      <div className="tlContent">
        <div className="tlCard">
          <div className="tlHead">
            <strong>{status === "stuck" ? "可能卡住" : "执行异常"}</strong>
          </div>
          <div className="inlineWarning">
            <strong>{errorMessage}</strong>
            <p>
              {status === "stuck"
                ? "当前阶段长时间没有结束。可以继续等待，也可以取消、重试或切换 agent。"
                : "任务执行中断，请查看上方阶段输出或打开调试详情定位原因。"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
  }, [text]);

  return (
    <button className="copyBtn" onClick={handleCopy} title="复制 Markdown" type="button">
      <Copy size={14} />
    </button>
  );
}

function MarkdownBlock({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`markdownBlock ${className}`}>
      <CopyButton text={content} />
      <div className="markdownBody">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function TimelineSummary({
  summary,
}: {
  summary: string;
}) {
  return (
    <div className="tlItem tlSummary">
      <div className="tlDot tlDotSuccess">
        <CheckCircle2 size={14} />
      </div>
      <div className="tlContent">
        <div className="tlHead tlMessageHead">
          <strong>Moss</strong>
          <span className="tlStatus tlStatus-completed">READY</span>
        </div>
        <div className="tlCard tlDeliveryCard">
          <MarkdownBlock content={summary} className="inlineSummary" />
        </div>
      </div>
    </div>
  );
}

function TimelineDebugLogs({ logs }: { logs: TaskLog[] }) {
  return (
    <div className="tlItem tlTaskLogs">
      <div className="tlDot">
        <TerminalSquare size={14} />
      </div>
      <div className="tlContent">
        <details className="tlDebugDetails tlSystemDebug">
          <summary>
            <TerminalSquare size={13} />
            系统调试日志
            <span>{logs.length} 条</span>
          </summary>
          <LogList logs={logs} />
        </details>
      </div>
    </div>
  );
}

function LogList({ logs }: { logs: TaskLog[] }) {
  return (
    <div className="tlLogList">
      {logs.map((log) => (
        <div key={log.id} className={`logLine ${log.level} ${deriveLogKind(log)}`}>
          <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
          <small>{deriveLogLabel(log)}</small>
          <span>{log.message}</span>
        </div>
      ))}
    </div>
  );
}

function isKeyLog(log: TaskLog) {
  if (log.level === "warn" || log.level === "error") return true;
  return /任务开始|任务完成|阶段开始|阶段完成|可能卡住|取消|重试|切换|无法执行|执行失败/.test(log.message);
}

function stageFallbackText(stage: TaskStage) {
  if (stage.status === "running") return "正在执行，等待 agent 输出。";
  if (stage.status === "completed") return "阶段已完成，暂无摘要。";
  if (stage.status === "failed") return "阶段执行失败，暂无详细摘要。";
  return "等待执行。";
}

function deriveLogKind(log: TaskLog): DerivedLogKind {
  if (log.level === "error") return "error";
  if (log.level === "warn") return "warning";
  return isKeyLog(log) ? "event" : "agent-output";
}

function deriveLogLabel(log: TaskLog) {
  const kind = deriveLogKind(log);
  if (kind === "error") return "错误";
  if (kind === "warning") return "警告";
  if (kind === "event") return "事件";
  return "输出";
}

function formatDuration(startedAt: Date, finishedAt: Date) {
  const seconds = Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${restSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function getVisibleStages(stages: TaskStage[]): TaskStage[] {
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

function buildConversationTurns(task: TaskWithRelations): ConversationTurn[] {
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

function messageRoleLabel(role: TaskMessage["role"]) {
  if (role === "user") return "用户";
  if (role === "system") return "系统";
  return "Agent";
}
