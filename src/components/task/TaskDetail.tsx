"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CircleStop,
  Code2,
  FileClock,
  FileText,
  Filter,
  ListChecks,
  MessageSquareText,
  PackageSearch,
  Play,
  RotateCcw,
  ScrollText,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TaskLog, TaskStage, TaskWithRelations } from "@/lib/types";
import { statusLabel } from "@/components/common/StatusDot";

interface TaskDetailProps {
  task: TaskWithRelations | null;
  onCancel: () => void;
  onRetry: () => void;
  onContinue: () => void;
  onSwitch: (agent: "claude" | "codex") => void;
}

type LogFilter = "all" | "key" | "warn" | "current";
type DerivedLogKind = "event" | "agent-output" | "warning" | "error";

export function TaskDetail({ task, onCancel, onRetry, onContinue, onSwitch }: TaskDetailProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(["summary", "logs"]));
  const [logFilter, setLogFilter] = useState<LogFilter>("key");

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

  const currentStage = useMemo(() => {
    if (!task) return null;
    return (
      task.stages.find((stage) => stage.name === task.currentStage) ||
      task.stages.find((stage) => stage.status === "running") ||
      task.stages.find((stage) => stage.status === "failed") ||
      null
    );
  }, [task]);

  const filteredLogs = useMemo(() => {
    if (!task) return [];
    return task.logs.filter((log) => {
      if (logFilter === "all") return true;
      if (logFilter === "warn") return log.level === "warn" || log.level === "error";
      if (logFilter === "current") return Boolean(currentStage?.id && log.stageId === currentStage.id);
      return isKeyLog(log);
    });
  }, [currentStage?.id, logFilter, task]);

  useEffect(() => {
    if (!task) return;
    setOpenSections((current) => {
      const next = new Set(current);
      if (currentStage?.id) next.add(currentStage.id);
      if (task.errorMessage || task.status === "failed" || task.status === "stuck") next.add("error");
      if (task.status === "completed") next.add("summary");
      return next;
    });
  }, [currentStage?.id, task?.id, task?.status, task?.errorMessage]);

  const toggleSection = (id: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!task) {
    return (
      <section className="detailPanel emptyDetail fade-in">
        <Code2 size={28} />
        <h2>等待任务</h2>
        <p>创建任务后，这里会显示阶段、日志、审查意见与交付摘要。</p>
      </section>
    );
  }

  const cancellable = ["queued", "running", "stuck"].includes(task.status);
  const retryable = !["queued", "running"].includes(task.status);
  const switchable = task.status === "stuck" || retryable;
  const reviewStages = task.stages.filter((stage) => ["review", "audit"].includes(stage.role));
  const latestLog = task.logs.at(-1);
  const latestContext = task.contextSnapshots[0] || null;
  const keyLogs = task.logs.filter(isKeyLog);

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

      <div className="taskMessage">
        <div className="messageAvatar">
          <Bot size={17} />
        </div>
        <div>
          <div className="messageMeta">
            <strong>Moss Agent</strong>
            <span>{new Date(task.createdAt).toLocaleString()}</span>
          </div>
          <p>{task.prompt}</p>
          {latestLog && <small>最近输出：{latestLog.message}</small>}
        </div>
      </div>

      <div className="runDigest">
        <DigestCard label="当前阶段" value={currentStage?.name || "等待调度"} hint={task.currentStage || statusLabel(task.status)} />
        <DigestCard label="阶段进度" value={`${completedStages(task.stages)} / ${task.stages.length}`} hint="已完成阶段" />
        <DigestCard label="关键事件" value={`${keyLogs.length}`} hint={`${task.logs.length} 条日志`} />
      </div>

      {task.errorMessage && (
        <Disclosure
          id="error"
          icon={<AlertTriangle size={16} />}
          title={task.status === "stuck" ? "可能卡住" : "异常提示"}
          status={statusLabel(task.status)}
          meta={currentStage ? `${currentStage.agent} / ${currentStage.role}` : ""}
          open={openSections.has("error")}
          onToggle={() => toggleSection("error")}
        >
          <div className="warning inlineWarning">
            <strong>{task.errorMessage}</strong>
            <p>
              {task.status === "stuck"
                ? "当前阶段长时间没有结束。可以继续等待，也可以取消、重试或切换 agent。"
                : "任务执行中断，请查看下方阶段输出和警告日志定位原因。"}
            </p>
          </div>
        </Disclosure>
      )}

      <div className="runStream" aria-label="任务执行时间线">
        {task.stages.map((stage) => (
          <StageDisclosure
            key={stage.id}
            stage={stage}
            logs={logsByStage.get(stage.id) || []}
            open={openSections.has(stage.id)}
            onToggle={() => toggleSection(stage.id)}
          />
        ))}
      </div>

      <Disclosure
        id="messages"
        icon={<MessageSquareText size={16} />}
        title="当前任务消息"
        status={`${task.messages.length} 条`}
        open={openSections.has("messages")}
        onToggle={() => toggleSection("messages")}
      >
        <div className="messageList">
          {task.messages.map((message) => (
            <article key={message.id} className="messageItem">
              <div className="messageMeta">
                <strong>{message.role === "user" ? "用户" : message.role}</strong>
                <span>{new Date(message.createdAt).toLocaleString()}</span>
                {message.includeInContext && <small>进入上下文</small>}
              </div>
              <p>{message.content}</p>
            </article>
          ))}
          {task.messages.length === 0 && <p className="emptyCopy">暂无补充消息。</p>}
        </div>
      </Disclosure>

      <Disclosure
        id="reviews"
        icon={<ListChecks size={16} />}
        title="审查意见"
        status={`${reviewStages.length} 个阶段`}
        open={openSections.has("reviews")}
        onToggle={() => toggleSection("reviews")}
      >
        {reviewStages.length ? (
          <div className="reviewList">
            {reviewStages.map((stage) => (
              <article key={stage.id} className="reviewItem">
                <strong>{stage.name}</strong>
                <pre>{stage.outputSummary || "等待输出。"}</pre>
              </article>
            ))}
          </div>
        ) : (
          <p className="emptyCopy">暂无审查输出。</p>
        )}
      </Disclosure>

      <Disclosure
        id="summary"
        icon={<CheckCircle2 size={16} />}
        title="交付摘要"
        status={task.summary ? "READY" : "PENDING"}
        open={openSections.has("summary")}
        onToggle={() => toggleSection("summary")}
      >
        <div className="summary inlineSummary">
          <pre>{task.summary || "任务完成后会生成交付摘要。"}</pre>
        </div>
      </Disclosure>

      <Disclosure
        id="context"
        icon={<PackageSearch size={16} />}
        title="上下文包 / 记忆"
        status={latestContext ? `${latestContext.tokenEstimate} tokens` : task.memoryMode}
        open={openSections.has("context")}
        onToggle={() => toggleSection("context")}
      >
        <div className="contextPackage">
          <div className="contextMeta">
            <span>记忆模式：{task.memoryMode}</span>
            <span>策略：{latestContext?.policy || task.contextPolicy}</span>
            <span>快照：{task.contextSnapshots.length} 个</span>
          </div>
          <pre>{latestContext?.content || "任务启动阶段时会生成实际传给 agent 的上下文包。"}</pre>
        </div>
      </Disclosure>

      <Disclosure
        id="logs"
        icon={<TerminalSquare size={16} />}
        title="实时日志"
        status={`${filteredLogs.length} / ${task.logs.length} 条`}
        open={openSections.has("logs")}
        onToggle={() => toggleSection("logs")}
      >
        <div className="logToolbar" aria-label="日志筛选">
          <Filter size={14} />
          <LogFilterButton active={logFilter === "key"} onClick={() => setLogFilter("key")}>
            关键事件
          </LogFilterButton>
          <LogFilterButton active={logFilter === "current"} onClick={() => setLogFilter("current")}>
            当前阶段
          </LogFilterButton>
          <LogFilterButton active={logFilter === "warn"} onClick={() => setLogFilter("warn")}>
            警告错误
          </LogFilterButton>
          <LogFilterButton active={logFilter === "all"} onClick={() => setLogFilter("all")}>
            全部
          </LogFilterButton>
        </div>
        <div className="logs inlineLogs">
          {filteredLogs.map((log) => (
            <div key={log.id} className={`logLine ${log.level} ${deriveLogKind(log)}`}>
              <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
              <small>{deriveLogLabel(log)}</small>
              <span>{log.message}</span>
            </div>
          ))}
          {filteredLogs.length === 0 && <p className="muted">当前筛选下暂无日志。</p>}
        </div>
      </Disclosure>
    </section>
  );
}

function DigestCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="digestCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function StageDisclosure({
  stage,
  logs,
  open,
  onToggle,
}: {
  stage: TaskStage;
  logs: TaskLog[];
  open: boolean;
  onToggle: () => void;
}) {
  const status = stage.status === "completed" ? "DONE" : statusLabel(stage.status);
  const started = stage.startedAt ? new Date(stage.startedAt) : null;
  const completed = stage.completedAt ? new Date(stage.completedAt) : null;
  const duration = started ? formatDuration(started, completed || new Date()) : "未开始";
  const keyLogs = logs.filter(isKeyLog);
  const latestReadableLog = keyLogs.at(-1) || logs.at(-1);
  const pathHint = `${stage.agent} / ${stage.role} / ${duration}`;

  return (
    <Disclosure
      id={stage.id}
      icon={<Code2 size={15} />}
      title={stage.name}
      status={status}
      meta={pathHint}
      open={open}
      onToggle={onToggle}
    >
      <div className="stageBody">
        <div className="stageTopline">
          <span>
            <Clock3 size={13} />
            {duration}
          </span>
          <span>
            <ScrollText size={13} />
            {logs.length} 条日志
          </span>
          <span>
            <FileClock size={13} />
            {latestReadableLog ? latestReadableLog.message : "等待阶段输出"}
          </span>
        </div>
        <div className="stageSummaryGrid">
          <div>
            <span>输入摘要</span>
            <pre>{stage.inputSummary || "等待开始。"}</pre>
          </div>
          <div>
            <span>输出摘要</span>
            <pre>{stage.outputSummary || "等待输出。"}</pre>
          </div>
        </div>
        <div className="stageLogPreview">
          <div className="miniHeader">
            <FileText size={14} />
            <span>关键阶段日志</span>
            <small>{keyLogs.length || logs.length} 条</small>
          </div>
          {(keyLogs.length ? keyLogs : logs).slice(-8).map((log) => (
            <div key={log.id} className={`logLine ${log.level} ${deriveLogKind(log)}`}>
              <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
              <small>{deriveLogLabel(log)}</small>
              <span>{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && <p className="emptyCopy">暂无阶段日志。</p>}
        </div>
      </div>
    </Disclosure>
  );
}

function LogFilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function Disclosure({
  id,
  icon,
  title,
  status,
  meta,
  open,
  onToggle,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  status: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      onToggle();
    }
  };

  return (
    <article id={id} className={open ? "runBlock open" : "runBlock"} onKeyDown={handleKeyDown}>
      <button
        id={`${id}-button`}
        className="runBlockHeader"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-content`}
      >
        <span className="runIcon">{icon}</span>
        <strong>{title}</strong>
        <span className="runMeta">{meta || ""}</span>
        <span className="runStatus">{status}</span>
        <ChevronDown className="runChevron" size={16} />
      </button>
      {open && (
        <div id={`${id}-content`} className="runBlockBody" role="region" aria-labelledby={`${id}-button`}>
          {children}
        </div>
      )}
    </article>
  );
}

function completedStages(stages: TaskStage[]) {
  return stages.filter((stage) => stage.status === "completed").length;
}

function isKeyLog(log: TaskLog) {
  if (log.level === "warn" || log.level === "error") return true;
  return /任务开始|任务完成|阶段开始|阶段完成|可能卡住|取消|重试|切换|无法执行|执行失败/.test(log.message);
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
