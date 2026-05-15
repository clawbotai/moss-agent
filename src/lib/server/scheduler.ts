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
  createAgentRun,
  completeAgentRun,
  createArtifact,
} from "@/lib/server/db";
import { extractMemoryFromTask } from "@/lib/server/memory";
import { buildContextPackage, saveContextSnapshot } from "@/lib/server/context";
import { nowIso } from "@/lib/server/time";
import { buildStagePrompt, buildWorkflow } from "@/lib/server/workflows";
import type { ArtifactType, LogLevel, StageStatus, TaskLog, TaskStage } from "@/lib/types";
import type { AgentRunResult } from "@/lib/agents/types";
import { getAgent } from "@/lib/agents/registry";

// 配置常量
const STUCK_TIMEOUT_MS = Number(process.env.MOSS_STUCK_TIMEOUT_MS) || 120000;
const MAX_LOG_LENGTH = 4000;
const MAX_SUMMARY_LENGTH = 8000;
const MAX_STAGE_SUMMARY_LENGTH = 2000;
const TERMINAL_STAGE_STATUSES = new Set<StageStatus>([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);
const SKIPPED_STAGE_ROLES = new Set<TaskStage["role"]>(["summarize"]);

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

  notifyTaskUpdated(taskId: string) {
    this.emitTask(taskId);
  }

  continueAfterMessage(taskId: string) {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");

    if (this.runningTasks.has(taskId) || ["queued", "running", "stuck", "waiting"].includes(task.status)) {
      this.log(taskId, "info", "已收到追加说明，当前任务执行中，后续阶段会带入该补充。");
      this.emitTask(taskId);
      return;
    }

    // 乐观锁：再次检查任务状态，防止并发创建阶段
    const currentTask = getTask(taskId);
    if (!currentTask || currentTask.status !== task.status) {
      this.log(taskId, "info", "任务状态已变更，跳过重复创建阶段。");
      this.emitTask(taskId);
      return;
    }

    const existingStages = listStages(taskId);
    const nextOrderIndex = existingStages.reduce(
      (max, stage) => Math.max(max, stage.orderIndex),
      -1,
    ) + 1;
    const continuationStages = buildWorkflow(task).map((stage, index) => ({
      ...stage,
      name: `追加任务：${stage.name}`,
      orderIndex: nextOrderIndex + index,
    }));

    createStages(taskId, continuationStages);
    updateTaskStatus(taskId, "queued", {
      currentStage: "等待追加任务执行",
      errorMessage: null,
      completedAt: null,
    });
    this.log(taskId, "info", "已将追加说明加入当前任务，并创建后续执行阶段。");
    this.enqueue(taskId);
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
      const mossAnswerSummaries: string[] = [];
      const deliverableSummaries: string[] = [];
      for (const stage of stages) {
        if (controller.signal.aborted) throw new Error("任务已取消");
        if (SKIPPED_STAGE_ROLES.has(stage.role)) {
          updateStage(stage.id, {
            status: "skipped",
            outputSummary: null,
            completedAt: stage.completedAt || nowIso(),
          });
          continue;
        }
        if (TERMINAL_STAGE_STATUSES.has(stage.status)) {
          if (stage.outputSummary) {
            summaries.push(`${stage.name}：${stage.outputSummary.slice(0, MAX_STAGE_SUMMARY_LENGTH)}`);
            collectRoleSummary(stage, mossAnswerSummaries, deliverableSummaries);
          }
          continue;
        }
        await this.runStage(taskId, project.path, stage, summaries, controller);
        const completedStage = listStages(taskId).find((item) => item.id === stage.id);
        if (completedStage) {
          collectRoleSummary(completedStage, mossAnswerSummaries, deliverableSummaries);
        }
      }

      const finalSummaries = mossAnswerSummaries.length ? mossAnswerSummaries : deliverableSummaries.length ? deliverableSummaries : summaries;
      const summary = finalSummaries.length
        ? finalSummaries.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "任务已完成，但没有生成阶段摘要。";
      updateTaskStatus(taskId, "completed", {
        currentStage: null,
        summary,
        completedAt: nowIso(),
      });

      // 自动提取项目记忆（草稿状态，需用户确认）
      try {
        const completedTask = getTaskWithRelations(taskId);
        if (completedTask) {
          extractMemoryFromTask(completedTask);
        }
      } catch {
        // 记忆提取失败不应影响任务完成状态
      }

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
    const contextPackage = await buildContextPackage(taskId, { stageId: stage.id });
    saveContextSnapshot(taskId, stage.id, contextPackage);
    const prompt = buildStagePrompt(task, stage, previousSummaries, contextPackage.content);
    updateStage(stage.id, {
      status: "running",
      startedAt,
      inputSummary: [
        `上下文策略：${contextPackage.policy}`,
        `记忆模式：${contextPackage.memoryMode}`,
        `预估 token：${contextPackage.tokenEstimate}`,
        prompt.slice(0, 900),
      ].join("\n"),
    });
    updateTaskStatus(taskId, "running", { currentStage: stage.name });
    this.log(taskId, "info", `阶段开始：${stage.name}`, { stageId: stage.id, agent: stage.agent });
    this.emitTask(taskId);

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

    // 记录 Agent Run 开始
    const agentRun = createAgentRun({
      taskId,
      stageId: stage.id,
      agent: stage.agent,
      command: `${stage.agent} ${stage.role}`,
    });

    let result: AgentRunResult;
    try {
      result =
        stage.role === "review" || stage.role === "audit"
          ? await adapter.review(runContext)
          : await adapter.run(runContext);
      // Agent Run 成功完成
      completeAgentRun(agentRun.id, {
        exitCode: result.exitCode,
        errorMessage: result.ok ? null : result.summary?.slice(0, 500) || null,
      });
    } catch (runError) {
      // Agent Run 异常
      completeAgentRun(agentRun.id, {
        exitCode: -1,
        errorMessage: runError instanceof Error ? runError.message.slice(0, 500) : "未知错误",
      });
      throw runError;
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

    // 为 plan/review/audit 阶段自动创建 artifact
    const ARTIFACT_TYPE_MAP: Record<string, string> = { plan: "plan", review: "review", audit: "report" };
    const artifactType = ARTIFACT_TYPE_MAP[stage.role];
    if (artifactType && result.summary) {
      createArtifact({
        taskId,
        stageId: stage.id,
        type: artifactType as ArtifactType,
        title: `${stage.name} 输出`,
        content: result.summary.slice(0, MAX_SUMMARY_LENGTH),
      });
    }

    this.log(taskId, "info", `阶段完成：${stage.name}`, {
      stageId: stage.id,
      summary: result.summary.slice(0, MAX_STAGE_SUMMARY_LENGTH),
    });
    this.emitTask(taskId);
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

function collectRoleSummary(
  stage: TaskStage,
  mossAnswerSummaries: string[],
  deliverableSummaries: string[],
) {
  if (!stage.outputSummary) return;
  const truncated = stage.outputSummary.slice(0, MAX_STAGE_SUMMARY_LENGTH);
  if (stage.role === "audit") {
    mossAnswerSummaries.push(truncated);
  }
  if (stage.role === "implement") {
    deliverableSummaries.push(`${stage.name}：${truncated}`);
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
