/**
 * 测试 db.ts 的状态转换矩阵
 */
import { getDb, updateTaskStatus, updateStage, createTask, createStages, getTask } from "../src/lib/server/db";
import type { TaskStatus, StageStatus } from "../src/lib/types";

// 模拟项目
const TEST_PROJECT_ID = "test-project";
type StageRow = { id: string; status: StageStatus };

function setupTestProject() {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO projects (id, name, path, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
    .run(TEST_PROJECT_ID, "Test Project", "/tmp/test", new Date().toISOString(), new Date().toISOString());
}

function cleanupTestProject() {
  const db = getDb();
  db.prepare("DELETE FROM tasks WHERE projectId = ?").run(TEST_PROJECT_ID);
  db.prepare("DELETE FROM projects WHERE id = ?").run(TEST_PROJECT_ID);
}

function testTaskTransitions() {
  console.log("=== 测试 1: 任务状态转换矩阵 ===");

  const validTransitions: [TaskStatus, TaskStatus][] = [
    ["queued", "running"],
    ["queued", "cancelled"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "cancelled"],
    ["running", "stuck"],
    ["running", "waiting"],
    ["stuck", "running"],
    ["stuck", "failed"],
    ["stuck", "cancelled"],
    ["waiting", "running"],
    ["waiting", "cancelled"],
    ["waiting", "failed"],
    ["waiting", "stuck"],
    ["failed", "queued"],
    ["cancelled", "queued"],
  ];

  const invalidTransitions: [TaskStatus, TaskStatus][] = [
    ["completed", "running"],
    ["completed", "failed"],
    ["completed", "cancelled"],
    ["queued", "completed"],
    ["queued", "failed"],
    ["running", "queued"],
  ];

  let passed = 0;
  let failed = 0;

  // 测试有效转换
  for (const [from, to] of validTransitions) {
    const task = createTask({
      projectId: TEST_PROJECT_ID,
      prompt: `Test ${from} -> ${to}`,
      mode: "collaborative",
      budget: "standard",
      permission: "workspaceWrite",
    });

    // 设置初始状态
    const db = getDb();
    db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(from, task.id);

    updateTaskStatus(task.id, to);

    const current = getTask(task.id);
    if (current?.status === to) {
      passed++;
    } else {
      console.log(`❌ 有效转换失败: ${from} -> ${to} (实际: ${current?.status})`);
      failed++;
    }
  }

  // 测试无效转换
  for (const [from, to] of invalidTransitions) {
    const task = createTask({
      projectId: TEST_PROJECT_ID,
      prompt: `Test invalid ${from} -> ${to}`,
      mode: "collaborative",
      budget: "standard",
      permission: "workspaceWrite",
    });

    const db = getDb();
    db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(from, task.id);

    // 捕获 warn
    let warnCalled = false;
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("非法状态转换")) {
        warnCalled = true;
      }
    };

    updateTaskStatus(task.id, to);
    console.warn = originalWarn;

    // 无效转换应该 warn 但仍然写入（当前实现）
    if (warnCalled) {
      passed++;
    } else {
      console.log(`❌ 无效转换未 warn: ${from} -> ${to}`);
      failed++;
    }
  }

  console.log(`结果: ${passed}/${passed + failed} 通过`);
  return failed === 0;
}

function testStageTransitions() {
  console.log("\n=== 测试 2: 阶段状态转换矩阵 ===");

  const validTransitions: [StageStatus, StageStatus][] = [
    ["queued", "running"],
    ["queued", "skipped"],
    ["queued", "cancelled"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "cancelled"],
  ];

  let passed = 0;
  let failed = 0;

  for (const [from, to] of validTransitions) {
    const task = createTask({
      projectId: TEST_PROJECT_ID,
      prompt: `Test stage ${from} -> ${to}`,
      mode: "collaborative",
      budget: "standard",
      permission: "workspaceWrite",
    });

    createStages(task.id, [{
      name: "Test Stage",
      agent: "claude",
      role: "plan",
      status: from,
      inputSummary: null,
      outputSummary: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      orderIndex: 0,
    }]);

    const db = getDb();
    const stage = db.prepare("SELECT id, status FROM stages WHERE taskId = ?").get(task.id) as StageRow | undefined;

    if (stage) {
      updateStage(stage.id, { status: to });
      const updated = db.prepare("SELECT id, status FROM stages WHERE id = ?").get(stage.id) as StageRow | undefined;

      if (updated?.status === to) {
        passed++;
      } else {
        console.log(`❌ 阶段转换失败: ${from} -> ${to} (实际: ${updated?.status})`);
        failed++;
      }
    }
  }

  console.log(`结果: ${passed}/${passed + failed} 通过`);
  return failed === 0;
}

function main() {
  console.log("开始测试状态转换矩阵...\n");

  setupTestProject();

  try {
    const results = [
      testTaskTransitions(),
      testStageTransitions(),
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

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
