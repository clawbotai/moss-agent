"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  MessageSquareText,
  TerminalSquare,
  User,
} from "lucide-react";
import type { TaskLog, TaskWithRelations } from "@/lib/types";
import type { CollaborationEntry, ConversationTurn } from "./types";
import { LogList } from "./LogList";
import { MarkdownBlock } from "./MarkdownBlock";
import { TimelineStage } from "./TimelineStage";
import { messageRoleLabel } from "./utils";

export function ConversationTurnView({
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
        return <TimelineSummary key={answer.key} summary={answer.summary} completedAt={answer.at} />;
      })}
    </div>
  );
}

export function TimelinePrompt({
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

export function TimelineMossMessage({ message }: { message: TaskWithRelations["messages"][number] }) {
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

export function TimelineCollaborationEntry({
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

export function TimelineSummary({
  summary,
  completedAt,
}: {
  summary: string;
  completedAt: number;
}) {
  return (
    <div className="tlItem tlSummary">
      <div className="tlDot tlDotSuccess">
        <CheckCircle2 size={14} />
      </div>
      <div className="tlContent">
        <div className="tlHead tlMessageHead">
          <strong>Moss</strong>
          <time>{Number.isFinite(completedAt) ? new Date(completedAt).toLocaleString() : ""}</time>
          <span className="tlStatus tlStatus-completed">READY</span>
        </div>
        <div className="tlCard tlDeliveryCard">
          <MarkdownBlock content={summary} className="inlineSummary" />
        </div>
      </div>
    </div>
  );
}

export function TimelineDebugLogs({ logs }: { logs: TaskLog[] }) {
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
