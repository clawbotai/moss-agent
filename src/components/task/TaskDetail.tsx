"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Code2,
  FileText,
  ListChecks,
  MessageSquareText,
  PackageSearch,
  Play,
  RotateCcw,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";
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

export function TaskDetail({ task, onCancel, onRetry, onContinue, onSwitch }: TaskDetailProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(["summary", "logs"]));

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

      <div className="runStream">
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

      {task.errorMessage && (
        <Disclosure
          id="error"
          icon={<AlertTriangle size={16} />}
          title="异常提示"
          status={statusLabel(task.status)}
          open={openSections.has("error")}
          onToggle={() => toggleSection("error")}
        >
          <div className="warning inlineWarning">{task.errorMessage}</div>
        </Disclosure>
      )}

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
        id="logs"
        icon={<TerminalSquare size={16} />}
        title="实时日志"
        status={`${task.logs.length} 条`}
        open={openSections.has("logs")}
        onToggle={() => toggleSection("logs")}
      >
        <div className="logs inlineLogs">
          {task.logs.map((log) => (
            <div key={log.id} className={`logLine ${log.level}`}>
              <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
              <span>{log.message}</span>
            </div>
          ))}
          {task.logs.length === 0 && <p className="muted">暂无日志。</p>}
        </div>
      </Disclosure>
    </section>
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
  const pathHint = `${stage.agent} / ${stage.role}`;

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
            <span>阶段日志</span>
            <small>{logs.length} 条</small>
          </div>
          {logs.slice(-8).map((log) => (
            <div key={log.id} className={`logLine ${log.level}`}>
              <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
              <span>{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && <p className="emptyCopy">暂无阶段日志。</p>}
        </div>
      </div>
    </Disclosure>
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
