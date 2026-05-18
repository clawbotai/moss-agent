import { EventEmitter } from "node:events";
import {
  appendLog,
  confirmTaskWithMessage,
  createStages,
  getProject,
  getProjectSettings,
  getTask,
  getTaskWithRelations,
  listStages,
  listTaskMessages,
  resetTaskForRetry,
  updateStage,
  updateTaskStatus,
  createAgentRun,
  completeAgentRun,
  createArtifact,
  getLatestAgentRunForStage,
  getRecoverableTasks,
  setPendingMode,
  applyTaskMode,
} from "@/lib/server/db";
import { extractMemoryFromTask } from "@/lib/server/memory";
import { buildContextPackage, saveContextSnapshot } from "@/lib/server/context";
import { nowIso } from "@/lib/server/time";
import { buildStagePrompt, buildWorkflow } from "@/lib/server/workflows";
import type { AgentRun, ArtifactType, LogLevel, StageStatus, TaskLog, TaskMode, TaskStage } from "@/lib/types";
import type { AgentRunResult } from "@/lib/agents/types";
import { getAgent } from "@/lib/agents/registry";

// 配置常量
const STUCK_WARN_MS = Number(process.env.MOSS_STUCK_WARN_MS) || 120000; // 2 分钟警告
const STUCK_ABORT_MS = Number(process.env.MOSS_STUCK_ABORT_MS) || 300000; // 5 分钟强制终止
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
const RESTART_BACKOFF_MS = Number(process.env.MOSS_AGENT_RESTART_BACKOFF_MS) || 5000;
const RESTART_BACKOFF_MAX_MS = Number(process.env.MOSS_AGENT_RESTART_BACKOFF_MAX_MS) || 60000;
const MAX_STAGE_ATTEMPTS = Number(process.env.MOSS_MAX_STAGE_ATTEMPTS) || 3;

/**
 * 自定义错误类型：用于标识任务等待用户确认的特殊状态。
 * 避免使用字符串匹配（脆弱），改用类型判断。
 */
export class WaitingForConfirmationError extends Error {
  constructor() {
    super("WAITING_FOR_CONFIRMATION");
    this.name = "WaitingForConfirmationError";
  }
}

/**
 * 确认流程业务错误，携带 HTTP 状态码供路由层使用。
 */
export class ConfirmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ConfirmError";
  }
}

type TaskEvent =
  | { type: "log"; taskId: string; log: TaskLog }
  | { type: "task"; taskId: string; task: ReturnType<typeof getTaskWithRelations> }
  | { type: "heartbeat"; taskId: string; at: string };

class TaskScheduler {
  private emitter = new EventEmitter();
  private queues = new Map<string, Promise<void>>();
  private abortControllers = new Map<string, AbortController>();
  private runningTasks = new Set<string>();
  private pendingConfirmationResponses = new Map<string, string>();

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
    // 覆盖 errorMessage：清除 waiting 状态下的确认请求 JSON
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

  /**
   * 用户确认后继续执行任务
   * @param taskId 任务 ID
   * @param userResponse 用户的确认回复（可以是选项文本或自由文本）
   */
  confirmAndContinue(taskId: string, userResponse: string) {
    const task = getTask(taskId);
    if (!task) throw new ConfirmError("任务不存在", 404);

    const normalizedResponse = userResponse.trim();
    if (!normalizedResponse) {
      throw new ConfirmError("确认回复不能为空", 400);
    }

    const truncatedResponse = normalizedResponse.length > MAX_LOG_LENGTH
      ? normalizedResponse.slice(0, MAX_LOG_LENGTH) + "..."
      : normalizedResponse;
    const messageContent = `需求确认回复：${truncatedResponse}`;

    const message = confirmTaskWithMessage({
      taskId,
      content: messageContent,
    });
    if (!message) {
      throw new ConfirmError("任务不在等待确认状态", 409);
    }

    this.pendingConfirmationResponses.set(taskId, messageContent);
    appendLog(taskId, "info", `用户确认回复：${truncatedResponse}`, { payload: { userResponse: truncatedResponse } });
    this.log(taskId, "info", "用户已确认，任务继续执行");
    this.emitTask(taskId);
    this.enqueue(taskId);
  }

  private consumeConfirmationResumeHint(taskId: string): string | undefined {
    let response = this.pendingConfirmationResponses.get(taskId);
    if (response) {
      this.pendingConfirmationResponses.delete(taskId);
    } else {
      // Fallback: 从数据库最近的 user message 中恢复（服务重启场景）
      const messages = listTaskMessages(taskId, 20);
      const confirmMsg = messages
        .filter((m) => m.role === "user" && m.content.startsWith("需求确认回复："))
        .pop();
      if (confirmMsg) response = confirmMsg.content;
    }
    if (!response) return undefined;
    return [
      "任务此前暂停等待用户确认。",
      response,
      "请基于这条确认回复继续当前阶段，不要重复询问同一个确认问题。",
    ].join("\n");
  }

  private joinResumeHints(...hints: Array<string | undefined>) {
    return hints.filter(Boolean).join("\n\n");
  }

  notifyTaskUpdated(taskId: string) {
    this.emitTask(taskId);
  }

  continueAfterMessage(taskId: string, modeOverride?: TaskMode) {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");

    // 任务正在运行：保存待生效模式，等当前执行完成后再应用
    if (this.runningTasks.has(taskId) || ["queued", "running", "stuck", "waiting"].includes(task.status)) {
      if (modeOverride && modeOverride !== task.mode) {
        // 用户明确指定了新模式，记录为待生效
        setPendingMode(taskId, modeOverride);
        this.log(taskId, "info", `已记录模式切换（${task.mode} → ${modeOverride}），当前任务执行完成后自动应用。`);
      } else if (modeOverride && task.pendingMode) {
        // 用户传入的 mode 与当前任务 mode 相同，说明用户可能切换回了默认模式，
        // 此时取消之前记录的待生效模式切换
        setPendingMode(taskId, null);
        this.log(taskId, "info", `已取消之前记录的模式切换，继续使用当前模式：${task.mode}`);
      } else {
        this.log(taskId, "info", "已收到追加说明，当前任务执行中，后续阶段会带入该补充。");
      }
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

    // 确定实际使用的模式：显式传入 > 待生效模式 > 任务原始模式
    const pendingMode = task.pendingMode;
    const effectiveMode = modeOverride || pendingMode || task.mode;
    if (effectiveMode !== task.mode || pendingMode) {
      applyTaskMode(taskId, effectiveMode);
    }
    const effectiveTask = { ...task, mode: effectiveMode, pendingMode: null };

    const existingStages = listStages(taskId);
    const nextOrderIndex = existingStages.reduce(
      (max, stage) => Math.max(max, stage.orderIndex),
      -1,
    ) + 1;
    const continuationStages = buildWorkflow(effectiveTask).map((stage, index) => ({
      ...stage,
      name: `追加任务：${stage.name}`,
      orderIndex: nextOrderIndex + index,
    }));

    createStages(taskId, continuationStages);
    if (effectiveMode !== task.mode) {
      this.log(taskId, "info", `追加任务切换模式：${task.mode} → ${effectiveMode}`);
    }
    updateTaskStatus(taskId, "queued", {
      currentStage: "等待追加任务执行",
      errorMessage: null,
      completedAt: null,
    });
    this.log(taskId, "info", "已将追加说明加入当前任务，并创建后续执行阶段。");
    this.enqueue(taskId);
  }

  /**
   * 服务启动时恢复中断的任务
   */
  recoverRunningTasks() {
    const recoverableTasks = getRecoverableTasks();
    for (const task of recoverableTasks) {
      if (task.status === "waiting") {
        this.log(task.id, "warn", "服务重启，任务仍在等待用户确认，保持暂停状态。");
        this.emitTask(task.id);
        continue;
      }
      this.log(task.id, "warn", "服务重启，恢复执行中任务，将从未完成阶段继续。");
      // 重新入队，scheduler 会自动跳过已完成阶段
      this.enqueue(task.id);
    }
    if (recoverableTasks.length > 0) {
      console.log(`[MOSS] 已处理 ${recoverableTasks.length} 个中断或等待中的任务`);
    }
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
        await this.runStageUntilDelivered(taskId, project.path, stage, summaries, controller);
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
          const settings = getProjectSettings(completedTask.projectId);
          if (settings.memoryExtractEnabled) {
            extractMemoryFromTask(completedTask);
          }
        }
      } catch {
        // 记忆提取失败不应影响任务完成状态
      }

      this.log(taskId, "info", "任务完成", { summary });
      this.emitTask(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "任务执行失败";

      // 等待用户确认：任务已设为 waiting 状态，不要覆盖为 failed
      if (error instanceof WaitingForConfirmationError) {
        this.runningTasks.delete(taskId);
        this.abortControllers.delete(taskId);
        return;
      }

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

  /**
   * 持续执行 stage 直到交付结果（超时后自动重启继续）
   */
  private async runStageUntilDelivered(
    taskId: string,
    projectPath: string,
    stage: TaskStage,
    previousSummaries: string[],
    controller: AbortController,
  ) {
    const latestRun = getLatestAgentRunForStage(stage.id);
    let attempt = latestRun ? parseAttemptFromCommand(latestRun.command) + 1 : 1;
    let lastResult: AgentRunResult | null = null;
    let persistedResumeHint = latestRun
      ? this.buildPersistedResumeHint(stage, latestRun, attempt)
      : undefined;
    const confirmationResumeHint = this.consumeConfirmationResumeHint(taskId);

    // MAX_STAGE_ATTEMPTS=0 表示不限制重试次数，>0 表示限制
    const maxAttempts = MAX_STAGE_ATTEMPTS > 0 ? MAX_STAGE_ATTEMPTS : Infinity;

    while (true) {
      // 检查是否超过最大尝试次数（在循环开头检查，防止无限循环）
      if (attempt > maxAttempts) {
        const errorMsg = `${stage.name} 已达到最大尝试次数 ${MAX_STAGE_ATTEMPTS}，停止自动重试`;
        updateStage(stage.id, {
          status: "failed",
          outputSummary: lastResult?.summary || null,
          completedAt: nowIso(),
          errorMessage: errorMsg,
        });
        throw new Error(errorMsg);
      }

      if (controller.signal.aborted) throw new Error("任务已取消");

      // 构建恢复提示
      const baseResumeHint = lastResult
        ? this.buildResumeHint(stage, lastResult, attempt)
        : persistedResumeHint;
      const resumeHint = this.joinResumeHints(confirmationResumeHint, baseResumeHint);
      persistedResumeHint = undefined;

      lastResult = await this.runStageAttempt(
        taskId,
        projectPath,
        stage,
        previousSummaries,
        controller,
        attempt,
        resumeHint,
      );

      // 成功交付
      if (lastResult.ok) {
        return;
      }

      // 用户取消
      if (lastResult.aborted || controller.signal.aborted) {
        throw new Error("任务已取消");
      }

      // 超时：自动重启
      if (lastResult.timedOut) {

        attempt++;
        const backoffMs = Math.min(
          RESTART_BACKOFF_MS * attempt,
          RESTART_BACKOFF_MAX_MS,
        );
        this.log(taskId, "warn", `阶段 ${stage.name} 超时，${backoffMs / 1000}s 后自动重启继续执行（第 ${attempt} 次尝试）。`, {
          stageId: stage.id,
        });
        this.emitTask(taskId);

        // 退避等待
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }

      // 非超时失败：直接抛出
      throw new Error(`${stage.name} 执行失败：${lastResult.summary}`);
    }
  }

  /**
   * 单次 stage attempt
   */
  private async runStageAttempt(
    taskId: string,
    projectPath: string,
    stage: TaskStage,
    previousSummaries: string[],
    controller: AbortController,
    attempt: number,
    resumeHint?: string,
  ): Promise<AgentRunResult> {
    const task = getTask(taskId);
    if (!task) throw new Error("任务不存在");

    const startedAt = nowIso();
    const isSimpleFirstStage = (task.mode === "codexOnly" || task.mode === "claudeOnly" || task.mode === "custom")
      && previousSummaries.length === 0 && stage.role === "implement";

    let prompt: string;
    let inputSummary: string;

    if (isSimpleFirstStage) {
      prompt = task.prompt;
      inputSummary = `attempt: ${attempt}\n${prompt.slice(0, 900)}`;
    } else {
      const contextPackage = await buildContextPackage(taskId, { stageId: stage.id });
      saveContextSnapshot(taskId, stage.id, contextPackage);
      prompt = buildStagePrompt(task, stage, previousSummaries, contextPackage.content);
      inputSummary = [
        `上下文策略：${contextPackage.policy}`,
        `记忆模式：${contextPackage.memoryMode}`,
        `预估 token：${contextPackage.tokenEstimate}`,
        `attempt: ${attempt}`,
        prompt.slice(0, 900),
      ].join("\n");
    }

    updateStage(stage.id, {
      status: "running",
      startedAt,
      inputSummary,
    });
    updateTaskStatus(taskId, "running", { currentStage: stage.name });
    this.log(taskId, "info", `阶段开始：${stage.name}（attempt ${attempt}）`, { stageId: stage.id, agent: stage.agent });
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

    // attemptController 用于用户取消和 stuck 超时终止
    const attemptController = new AbortController();
    const abortAttempt = () => attemptController.abort();
    controller.signal.addEventListener("abort", abortAttempt, { once: true });
    if (controller.signal.aborted) attemptController.abort();

    // stuck 两阶段定时器
    let stuckWarned = false;
    let stuckTimedOut = false;
    let stuckAbortTimer: ReturnType<typeof setTimeout> | null = null;
    const stuckTimer = setTimeout(() => {
      stuckWarned = true;
      updateTaskStatus(taskId, "stuck", { currentStage: stage.name });
      this.log(taskId, "warn", `阶段超过 ${STUCK_WARN_MS / 1000} 秒没有结束，可能卡住：${stage.name}`, {
        stageId: stage.id,
      });
      this.emitTask(taskId);

      // 二次超时：强制终止当前 attempt
      stuckAbortTimer = setTimeout(() => {
        const currentTask = getTask(taskId);
        if (!controller.signal.aborted && currentTask?.status === "stuck") {
          stuckTimedOut = true;
          this.log(taskId, "error", `阶段超过 ${STUCK_ABORT_MS / 1000} 秒，强制终止当前 attempt：${stage.name}`);
          attemptController.abort();
        }
      }, Math.max(STUCK_ABORT_MS - STUCK_WARN_MS, 0));
    }, STUCK_WARN_MS);

    const runContext = {
      taskId,
      stageId: stage.id,
      projectPath,
      prompt,
      budget: task.budget,
      permission: task.permission,
      signal: attemptController.signal,
      onLog,
      attempt,
      resumeHint,
    };

    // 记录 Agent Run 开始
    const agentRun = createAgentRun({
      taskId,
      stageId: stage.id,
      agent: stage.agent,
      command: `${stage.agent} ${stage.role} (attempt ${attempt})`,
    });

    let result: AgentRunResult;
    try {
      result =
        stage.role === "review" || stage.role === "audit"
          ? await adapter.review(runContext)
          : await adapter.run(runContext);

      // stuck 超时终止：覆盖结果为 timedOut（非用户取消）
      if (stuckTimedOut && result.aborted && !controller.signal.aborted) {
        result = {
          ...result,
          ok: false,
          timedOut: true,
          aborted: false,
          summary: result.summary || `阶段 ${stage.name} 超过 ${STUCK_ABORT_MS / 1000} 秒，当前 attempt 已终止`,
        };
      }

      // Agent Run 完成
      completeAgentRun(agentRun.id, {
        exitCode: result.exitCode,
        errorMessage: result.timedOut
          ? `timeout (attempt ${attempt})`
          : result.ok
            ? null
            : result.summary?.slice(0, 500) || null,
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
      if (stuckAbortTimer) clearTimeout(stuckAbortTimer);
      controller.signal.removeEventListener("abort", abortAttempt);
    }

    // stuck 后恢复正常状态
    if (stuckWarned && result.ok) {
      updateTaskStatus(taskId, "running", { currentStage: stage.name, errorMessage: null });
      this.log(taskId, "info", `阶段 ${stage.name} 已恢复正常执行`);
    }

    // Agent 请求用户确认：暂停任务等待用户回复
    if (result.confirmationRequest) {
      updateTaskStatus(taskId, "waiting", {
        currentStage: stage.name,
        errorMessage: JSON.stringify(result.confirmationRequest),
      });
      this.log(taskId, "info", `阶段 ${stage.name} 需要用户确认：${result.confirmationRequest.question}`, {
        stageId: stage.id,
        confirmationRequest: result.confirmationRequest,
      });
      this.emitTask(taskId);
      throw new WaitingForConfirmationError();
    }

    if (!result.ok) {
      // 超时不标记 stage 为 failed，留给 runStageUntilDelivered 处理
      if (result.timedOut) {
        this.log(taskId, "warn", `阶段 ${stage.name} 超时（attempt ${attempt}），将自动重试。`, {
          stageId: stage.id,
        });
        return result;
      }

      // 非超时失败
      updateStage(stage.id, {
        status: "failed",
        outputSummary: result.summary,
        completedAt: nowIso(),
        errorMessage: `退出码：${result.exitCode ?? "unknown"}`,
      });
      return result;
    }

    // 成功
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

    return result;
  }

  /**
   * 构建恢复提示公共尾部
   */
  private buildResumeHintTail(): string[] {
    return [
      "",
      "请检查当前工作区状态（git status / git diff），了解已完成内容。",
      "已完成的内容不要重做；继续完成未交付部分。",
    ];
  }

  /**
   * 构建恢复提示（超时后）
   */
  private buildResumeHint(stage: TaskStage, lastResult: AgentRunResult, attempt: number): string {
    const parts = [
      `阶段 "${stage.name}" 第 ${attempt - 1} 次执行因超时被终止。`,
      `上次退出码：${lastResult.exitCode ?? "unknown"}`,
    ];

    if (lastResult.summary) {
      parts.push("上次输出摘要：");
      parts.push(lastResult.summary.slice(0, 1000));
    }

    parts.push(...this.buildResumeHintTail());
    return parts.join("\n");
  }

  /**
   * 构建恢复提示（服务重启后）
   */
  private buildPersistedResumeHint(stage: TaskStage, latestRun: AgentRun, attempt: number): string {
    const parts = [
      `阶段 "${stage.name}" 检测到服务重启前已有执行记录。`,
      `最近一次 agent run：${latestRun.command}`,
      `最近一次开始时间：${latestRun.startedAt}`,
      `本次将作为第 ${attempt} 次尝试继续。`,
    ];

    if (latestRun.completedAt) {
      parts.push(`最近一次结束时间：${latestRun.completedAt}`);
    }
    if (latestRun.exitCode !== null) {
      parts.push(`最近一次退出码：${latestRun.exitCode}`);
    }
    if (latestRun.errorMessage) {
      parts.push(`最近一次错误：${latestRun.errorMessage}`);
    }

    parts.push(...this.buildResumeHintTail());

    return parts.join("\n");
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

/**
 * 从 agent_run 的 command 字符串中解析 attempt 序号
 * 格式: "claude plan (attempt 2)" -> 2
 *
 * 注意：这个方法依赖 command 字符串格式，如果格式变化会 fallback 到 1。
 * 未来建议在 agent_runs 表中添加 attempt 列来结构化存储。
 */
function parseAttemptFromCommand(command: string) {
  const match = command.match(/\(attempt\s+(\d+)\)/i);
  if (!match) return 1;
  const attempt = Number.parseInt(match[1], 10);
  return Number.isFinite(attempt) && attempt > 0 ? attempt : 1;
}

declare global {
  var mossScheduler: TaskScheduler | undefined;
}

export function getScheduler() {
  if (!globalThis.mossScheduler) {
    globalThis.mossScheduler = new TaskScheduler();
    // 服务启动时恢复中断的任务
    globalThis.mossScheduler.recoverRunningTasks();
  }
  return globalThis.mossScheduler;
}
