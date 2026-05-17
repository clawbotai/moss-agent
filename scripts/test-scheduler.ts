/**
 * 测试调度器的超时自动恢复和 stuck 处理
 * 注意：这个测试需要实际的 CLI 工具（claude/codex）
 */
import { getScheduler } from "../src/lib/server/scheduler";
import {
  createTask,
  createStages,
  getTask,
  listStages,
  getDb,
  updateTaskStatus,
  getRecoverableTasks,
  createProject,
} from "../src/lib/server/db";
import type { TaskStatus } from "../src/lib/types";

let testProject: any;

function setupTestProject() {
  testProject = createProject({
    name: "Test Scheduler Project",
    path: process.cwd(),
  });
}

function cleanupTestProject() {
  if (!testProject) return;
  const db = getDb();
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(testProject.id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(testProject.id);
}

function testRecoverableTasks() {
  console.log("=== 测试 1: 可恢复任务查询 ===");

  // 创建测试任务
  const task1 = createTask({
    projectId: testProject.id,
    prompt: "Running task",
    mode: "collaborative",
    budget: "standard",
    permission: "workspaceWrite",
  });

  const task2 = createTask({
    projectId: testProject.id,
    prompt: "Stuck task",
    mode: "collaborative",
    budget: "standard",
    permission: "workspaceWrite",
  });

  const task3 = createTask({
    projectId: testProject.id,
    prompt: "Completed task",
    mode: "collaborative",
    budget: "standard",
    permission: "workspaceWrite",
  });

  // 设置不同状态
  updateTaskStatus(task1.id, "running");
  updateTaskStatus(task2.id, "stuck");
  updateTaskStatus(task3.id, "completed");

  // 查询可恢复任务
  const recoverable = getRecoverableTasks();
  const recoverableIds = recoverable.map(t => t.id);

  console.log(`可恢复任务数: ${recoverable.length}`);
  console.log(`包含 running 任务: ${recoverableIds.includes(task1.id)}`);
  console.log(`包含 stuck 任务: ${recoverableIds.includes(task2.id)}`);
  console.log(`不包含 completed 任务: !${recoverableIds.includes(task3.id)}`);

  const pass =
    recoverable.length === 2 &&
    recoverableIds.includes(task1.id) &&
    recoverableIds.includes(task2.id) &&
    !recoverableIds.includes(task3.id);

  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

function testSchedulerSingleton() {
  console.log("\n=== 测试 2: 调度器单例 ===");

  const scheduler1 = getScheduler();
  const scheduler2 = getScheduler();

  console.log(`单例: ${scheduler1 === scheduler2}`);

  const pass = scheduler1 === scheduler2;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

function testStuckTimeoutConfig() {
  console.log("\n=== 测试 3: stuck 超时配置 ===");

  const stuckWarnMs = Number(process.env.MOSS_STUCK_WARN_MS) || 120000;
  const stuckAbortMs = Number(process.env.MOSS_STUCK_ABORT_MS) || 300000;

  console.log(`stuck 警告时间: ${stuckWarnMs / 1000}s`);
  console.log(`stuck 强制终止时间: ${stuckAbortMs / 1000}s`);
  console.log(`警告时间 < 强制终止时间: ${stuckWarnMs < stuckAbortMs}`);

  const pass = stuckWarnMs < stuckAbortMs && stuckWarnMs >= 60000 && stuckAbortMs >= stuckWarnMs;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

function testRestartBackoffConfig() {
  console.log("\n=== 测试 4: 重启退避配置 ===");

  const backoffMs = Number(process.env.MOSS_AGENT_RESTART_BACKOFF_MS) || 5000;
  const backoffMaxMs = Number(process.env.MOSS_AGENT_RESTART_BACKOFF_MAX_MS) || 60000;
  const maxAttempts = Number(process.env.MOSS_MAX_STAGE_ATTEMPTS) || 3;

  console.log(`基础退避时间: ${backoffMs / 1000}s`);
  console.log(`最大退避时间: ${backoffMaxMs / 1000}s`);
  console.log(`最大尝试次数: ${maxAttempts}`);
  console.log(`基础 < 最大: ${backoffMs < backoffMaxMs}`);

  const pass = backoffMs < backoffMaxMs && maxAttempts > 0;
  console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
  return pass;
}

async function main() {
  console.log("开始测试调度器...\n");

  setupTestProject();

  try {
    const results = [
      testRecoverableTasks(),
      testSchedulerSingleton(),
      testStuckTimeoutConfig(),
      testRestartBackoffConfig(),
    ];

    const passed = results.filter(Boolean).length;
    console.log(`\n=== 测试完成: ${passed}/${results.length} 通过 ===`);

    if (passed < results.length) {
      process.exit(1);
    }
  } finally {
    cleanupTestProject();
  }
}

main();
