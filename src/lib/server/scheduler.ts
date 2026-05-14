import { EventEmitter } from "node:events";
import {
  appendLog,
  createStages,
  getProject,
  getTask,
  getTaskWithRelations,
  listStages,
  resetTaskForRetry,
  updateStage,
  updateTaskStatus,
} from "@/lib/server/db";
import { nowIso } from "@/lib/server/time";
import { buildStagePrompt, buildWorkflow } from "@/lib/server/workflows";
import type { LogLevel, TaskLog, TaskStage } from "@/lib/types";
import type { AgentRunResult } from "@/lib/agents/types";
import { getAgent } from "@/lib/agents/registry";

// 配置常量
const STUCK_TIMEOUT_MS = Number(process.env.MOSS_STUCK_TIMEOUT_MS) || 120000;
const MAX_LOG_LENGTH = 4000;
const MAX_SUMMARY_LENGTH = 8000;
const MAX_STAGE_SUMMARY_LENGTH = 2000;

type TaskEvent =
  | { type: "log"; taskId: string; log: TaskLog }
  | { type: "task"; taskId: string; task: ReturnType<typeof getTaskWithRelations> }
  | { type: "heartbeat"; taskId: string; at: string };

class TaskScheduler {
  private emitter = new EventEmitter();
  private queues = new Map<string, Promise<void>>();
  private abortControllers = new Map<string, AbortController>();
  private runningTasks = new Set<string>();

  subscribe(taskId: string, listener: (event: TaskEvent) => void) {
    const handler = (event: TaskEvent) => {
      if (event.taskId === taskId) listener(event);
    };
    this.emitter.on("event", handler);
    return () => this.emitter.off("event", handler);
  }

  enqueue(taskId: string) {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");

    const projectQueue = this.queues.get(task.projectId) || Promise.resolve();
    const nextQueue = projectQueue
      .catch(() => undefined)
      .then(() => this.runTask(taskId))
      .catch((error) => {
        this.log(taskId, "error", error instanceof Error ? error.message : "任务执行失败");
      });

    this.queues.set(task.projectId, nextQueue);
    this.emitTask(taskId);
  }

  retry(taskId: string) {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");
    if (this.runningTasks.has(taskId)) throw new Error("任务正在运行，不能重试");
    resetTaskForRetry(taskId);
    this.log(taskId, "info", "任务已重置，重新进入队列");
    this.enqueue(taskId);
  }

  cancel(taskId: string) {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.log(taskId, "warn", "已请求取消当前任务");
    }
    updateTaskStatus(taskId, "cancelled", {
      currentStage: null,
      completedAt: nowIso(),
      errorMessage: "用户取消任务",
    });
    this.emitTask(taskId);
  }

  continue(taskId: string) {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");
    if (task.status !== "stuck") return;
    updateTaskStatus(taskId, "running", { errorMessage: null });
    this.log(taskId, "info", "用户选择继续等待当前阶段");
    this.emitTask(taskId);
  }

  private async runTask(taskId: string) {
    if (this.runningTasks.has(taskId)) return;

    const task = getTask(taskId);
    if (!task) return;

    const project = getProject(task.projectId);
    if (!project) {
      updateTaskStatus(taskId, "failed", {
        errorMessage: "项目不存在",
        completedAt: nowIso(),
      });
      this.emitTask(taskId);
      return;
    }

    this.runningTasks.add(taskId);
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    try {
      updateTaskStatus(taskId, "running", {
        startedAt: task.startedAt || nowIso(),
        errorMessage: null,
      });
      this.log(taskId, "info", `任务开始：${task.title}`);

      let stages = listStages(taskId);
      if (stages.length === 0) {
        createStages(taskId, buildWorkflow(task));
        stages = listStages(taskId);
      }

      const summaries: string[] = [];
      for (const stage of stages) {
        if (controller.signal.aborted) throw new Error("任务已取消");
        await this.runStage(taskId, project.path, stage, summaries, controller);
      }

      const summary = summaries.length
        ? summaries.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "任务已完成，但没有生成阶段摘要。";
      updateTaskStatus(taskId, "completed", {
        currentStage: null,
        summary,
        completedAt: nowIso(),
      });
      this.log(taskId, "info", "任务完成", { summary });
      this.emitTask(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务执行失败";
      const status = controller.signal.aborted ? "cancelled" : "failed";
      updateTaskStatus(taskId, status, {
        currentStage: null,
        errorMessage: message,
        completedAt: nowIso(),
      });
      this.log(taskId, status === "cancelled" ? "warn" : "error", message);
      this.emitTask(taskId);
    } finally {
      this.runningTasks.delete(taskId);
      this.abortControllers.delete(taskId);
    }
  }

  private async runStage(
    taskId: string,
    projectPath: string,
    stage: TaskStage,
    previousSummaries: string[],
    controller: AbortController,
  ) {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");

    const startedAt = nowIso();
    const prompt = buildStagePrompt(task, stage, previousSummaries);
    updateStage(stage.id, { status: "running", startedAt, inputSummary: prompt.slice(0, 1200) });
    updateTaskStatus(taskId, "running", { currentStage: stage.name });
    this.log(taskId, "info", `阶段开始：${stage.name}`, { stageId: stage.id, agent: stage.agent });
    this.emitTask(taskId);

    if (stage.role === "summarize") {
      const output = this.buildFinalSummary(previousSummaries);
      updateStage(stage.id, {
        status: "completed",
        outputSummary: output,
        completedAt: nowIso(),
      });
      previousSummaries.push(`${stage.name}：${output}`);
      this.log(taskId, "info", output, { stageId: stage.id });
      this.emitTask(taskId);
      return;
    }

    const diagnostic = await getAgent(stage.agent).detect();
    if (!diagnostic.available) {
      updateStage(stage.id, {
        status: "failed",
        completedAt: nowIso(),
        errorMessage: diagnostic.message,
      });
      throw new Error(`${stage.name} 无法执行：${diagnostic.message}`);
    }

    const adapter = getAgent(stage.agent);
    const onLog = (message: string, payload?: unknown) => {
      this.log(taskId, "info", normalizeLogChunk(message), { stageId: stage.id, payload });
    };
    const stuckTimer = setTimeout(() => {
      updateTaskStatus(taskId, "stuck", { currentStage: stage.name });
      this.log(taskId, "warn", `阶段超过 ${STUCK_TIMEOUT_MS / 1000} 秒没有结束，可能卡住：${stage.name}`, {
        stageId: stage.id,
      });
      this.emitTask(taskId);
    }, STUCK_TIMEOUT_MS);

    const runContext = {
      taskId,
      stageId: stage.id,
      projectPath,
      prompt,
      budget: task.budget,
      permission: task.permission,
      signal: controller.signal,
      onLog,
    };

    let result: AgentRunResult;
    try {
      result =
        stage.role === "review" || stage.role === "audit"
          ? await adapter.review(runContext)
          : await adapter.run(runContext);
    } finally {
      clearTimeout(stuckTimer);
    }

    if (!result.ok) {
      updateStage(stage.id, {
        status: "failed",
        outputSummary: result.summary,
        completedAt: nowIso(),
        errorMessage: `退出码：${result.exitCode ?? "unknown"}`,
      });
      throw new Error(`${stage.name} 执行失败：${result.summary}`);
    }

    updateStage(stage.id, {
      status: "completed",
      outputSummary: result.summary.slice(0, MAX_SUMMARY_LENGTH),
      completedAt: nowIso(),
    });
    previousSummaries.push(`${stage.name}：${result.summary.slice(0, MAX_STAGE_SUMMARY_LENGTH)}`);
    this.log(taskId, "info", `阶段完成：${stage.name}`, {
      stageId: stage.id,
      summary: result.summary.slice(0, MAX_STAGE_SUMMARY_LENGTH),
    });
    this.emitTask(taskId);
  }

  private buildFinalSummary(previousSummaries: string[]) {
    return [
      "交付汇总已生成。",
      "阶段结果：",
      previousSummaries.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    ].join("\n");
  }

  private log(taskId: string, level: LogLevel, message: string, payload?: unknown) {
    const log = appendLog(taskId, level, message, {
      stageId:
        typeof payload === "object" && payload && "stageId" in payload
          ? String((payload as { stageId: string }).stageId)
          : null,
      payload,
    });
    this.emitter.emit("event", { type: "log", taskId, log } satisfies TaskEvent);
  }

  private emitTask(taskId: string) {
    this.emitter.emit("event", {
      type: "task",
      taskId,
      task: getTaskWithRelations(taskId),
    } satisfies TaskEvent);
  }
}

function normalizeLogChunk(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "[空输出]";
  return trimmed.length > MAX_LOG_LENGTH ? `${trimmed.slice(0, MAX_LOG_LENGTH)}...` : trimmed;
}

declare global {
  // eslint-disable-next-line no-var
  var mossScheduler: TaskScheduler | undefined;
}

export function getScheduler() {
  if (!globalThis.mossScheduler) {
    globalThis.mossScheduler = new TaskScheduler();
  }
  return globalThis.mossScheduler;
}
