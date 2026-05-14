"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleStop,
  Code2,
  Play,
  RotateCcw,
} from "lucide-react";
import type { TaskWithRelations } from "@/lib/types";
import { StatusDot, statusLabel } from "@/components/common/StatusDot";

interface TaskDetailProps {
  task: TaskWithRelations | null;
  onCancel: () => void;
  onRetry: () => void;
  onContinue: () => void;
  onSwitch: (agent: "claude" | "codex") => void;
}

export function TaskDetail({ task, onCancel, onRetry, onContinue, onSwitch }: TaskDetailProps) {
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

  return (
    <section className="detailPanel fade-in">
      <div className="detailHeader">
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

      <div className="timeline">
        {task.stages.map((stage) => (
          <div key={stage.id} className={`stage ${stage.status}`}>
            <StatusDot status={stage.status} />
            <div>
              <strong>{stage.name}</strong>
              <small>{stage.agent} · {stage.role}</small>
            </div>
          </div>
        ))}
      </div>

      {task.errorMessage && (
        <div className="warning">
          <AlertTriangle size={17} />
          {task.errorMessage}
        </div>
      )}

      {task.summary && (
        <div className="summary">
          <CheckCircle2 size={18} />
          <pre>{task.summary}</pre>
        </div>
      )}

      <div className="logPanel">
        <div className="logHeader">
          <span>实时日志</span>
          <small>{task.logs.length} 条</small>
        </div>
        <div className="logs">
          {task.logs.map((log) => (
            <div key={log.id} className={`logLine ${log.level}`}>
              <time>{new Date(log.createdAt).toLocaleTimeString()}</time>
              <span>{log.message}</span>
            </div>
          ))}
          {task.logs.length === 0 && <p className="muted">暂无日志。</p>}
        </div>
      </div>
    </section>
  );
}
