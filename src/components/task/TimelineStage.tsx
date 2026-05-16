"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Code2,
  TerminalSquare,
} from "lucide-react";
import type { TaskLog, TaskStage } from "@/lib/types";
import { statusLabel } from "@/components/common/StatusDot";
import { LogList } from "./LogList";
import { MarkdownBlock } from "./MarkdownBlock";
import { formatDuration, isKeyLog, stageFallbackText } from "./utils";

const VALID_STAGE_STATUSES = new Set(["queued", "running", "completed", "failed", "waiting", "skipped", "cancelled"]);

export function TimelineStage({
  stage,
  logs,
}: {
  stage: TaskStage;
  logs: TaskLog[];
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (stage.status !== "running" || !stage.startedAt) return;
    const startedAt = new Date(stage.startedAt).getTime();
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      setNow(new Date());
      const elapsed = Date.now() - startedAt;
      // 前 2 分钟每秒更新，之后每 5 秒更新以减少性能开销
      const delay = elapsed < 120_000 ? 1000 : 5000;
      timer = setTimeout(tick, delay);
    }

    tick();
    return () => clearTimeout(timer);
  }, [stage.status, stage.startedAt]);

  const started = stage.startedAt ? new Date(stage.startedAt) : null;
  const completed = stage.completedAt ? new Date(stage.completedAt) : null;
  const duration = started ? formatDuration(started, completed || now) : null;
  const status = stage.status === "completed" ? "DONE" : statusLabel(stage.status);
  const isRunning = stage.status === "running";
  const isFailed = stage.status === "failed";
  let keyLog: TaskLog | undefined;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (isKeyLog(logs[i])) { keyLog = logs[i]; break; }
  }
  const MAX_AUDIT_DISPLAY = 300;
  const rawAuditText = keyLog?.message || stage.errorMessage || "";
  const auditText = rawAuditText.length > MAX_AUDIT_DISPLAY ? `${rawAuditText.slice(0, MAX_AUDIT_DISPLAY)}…` : rawAuditText;
  const displayText = stage.role === "audit" ? auditText : stage.outputSummary || keyLog?.message || stage.errorMessage || "";
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
            <div className="tlStageBodyInner">
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
          </div>
        </details>
      </div>
    </div>
  );
}
