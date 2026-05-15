"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  CircleStop,
  Code2,
  MessageSquareText,
  Play,
  RotateCcw,
  TerminalSquare,
  User,
} from "lucide-react";
import { useMemo } from "react";
import type { TaskLog, TaskStage, TaskWithRelations } from "@/lib/types";
import { statusLabel } from "@/components/common/StatusDot";

interface TaskDetailProps {
  task: TaskWithRelations | null;
  onCancel: () => void;
  onRetry: () => void;
  onContinue: () => void;
  onSwitch: (agent: "claude" | "codex") => void;
}

type DerivedLogKind = "event" | "agent-output" | "warning" | "error";

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

  if (!task) return null;

  const cancellable = ["queued", "running", "stuck"].includes(task.status);
  const retryable = !["queued", "running"].includes(task.status);
  const switchable = task.status === "stuck" || retryable;
  const stageErrorMessages = new Set(task.stages.map((s) => s.errorMessage).filter(Boolean));
  const showTopLevelError = task.errorMessage && !stageErrorMessages.has(task.errorMessage);

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
        <TimelinePrompt prompt={task.prompt} createdAt={task.createdAt} />

        {task.messages.map((message) => (
          <TimelineMessage key={message.id} message={message} />
        ))}

        {task.stages.map((stage) => (
          <TimelineStage
            key={stage.id}
            stage={stage}
            logs={logsByStage.get(stage.id) || []}
          />
        ))}

        {showTopLevelError && (
          <TimelineError errorMessage={task.errorMessage!} status={task.status} />
        )}

        {task.summary && <TimelineSummary summary={task.summary} />}

        {taskLevelLogs.length > 0 && <TimelineDebugLogs logs={taskLevelLogs} />}
      </div>
    </section>
  );
}

function TimelinePrompt({ prompt, createdAt }: { prompt: string; createdAt: string }) {
  return (
    <div className="tlItem tlPrompt">
      <div className="tlDot">
        <User size={14} />
      </div>
      <div className="tlContent">
        <div className="tlCard tlUserCard">
          <div className="tlHead">
            <strong>用户</strong>
            <time>{new Date(createdAt).toLocaleString()}</time>
          </div>
          <p className="tlPromptText">{prompt}</p>
        </div>
      </div>
    </div>
  );
}

function TimelineMessage({ message }: { message: TaskWithRelations["messages"][number] }) {
  return (
    <div className="tlItem tlMessages">
      <div className="tlDot">
        <MessageSquareText size={14} />
      </div>
      <div className="tlContent">
        <div className="tlCard">
          <div className="tlHead">
            <strong>{message.role === "user" ? "用户补充" : message.role}</strong>
            <time>{new Date(message.createdAt).toLocaleString()}</time>
            {message.includeInContext && <span className="tlContextBadge">进入上下文</span>}
          </div>
          <p className="tlPromptText">{message.content}</p>
        </div>
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
        <div className="tlCard">
          <div className="tlHead">
            <strong>{stage.name}</strong>
            <span className="tlMeta">{stage.agent} / {stage.role}</span>
            {duration && (
              <span className="tlDuration">
                <Clock3 size={12} />
                {duration}
              </span>
            )}
            <span className={`tlStatus tlStatus-${VALID_STAGE_STATUSES.has(stage.status) ? stage.status : "queued"}`}>{status}</span>
          </div>
          {showBody && (
            <div className="tlStageText">
              {displayText ? <pre>{displayText}</pre> : <p>{stageFallbackText(stage)}</p>}
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
        <div className="tlCard tlDeliveryCard">
          <div className="tlHead">
            <strong>交付摘要</strong>
            <span className="tlStatus tlStatus-completed">READY</span>
          </div>
          <div className="inlineSummary">
            <pre>{summary}</pre>
          </div>
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
