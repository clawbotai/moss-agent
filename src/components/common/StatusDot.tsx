"use client";

import type { StageStatus, TaskStatus } from "@/lib/types";

export function StatusDot({ status }: { status: TaskStatus | StageStatus | string }) {
  return <i className={`statusDot ${status}`} />;
}

export function statusLabel(status: TaskStatus | StageStatus | string): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    running: "运行中",
    waiting: "等待中",
    stuck: "可能卡住",
    failed: "失败",
    cancelled: "已取消",
    completed: "已完成",
    skipped: "已跳过",
  };
  return labels[status] || status;
}
