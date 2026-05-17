/**
 * 测试 process.ts 的 SIGKILL 兜底和超时机制
 */
import { runProcess } from "../src/lib/agents/process";

async function testProcessTimeout() {
  console.log("=== 测试 1: 进程超时 ===");
  const start = Date.now();

  try {
    const result = await runProcess({
      command: "node",
      args: ["-e", "setTimeout(() => console.log('done'), 10000)"], // 10 秒后输出
      cwd: process.cwd(),
      timeoutMs: 2000, // 2 秒超时
    });

    const elapsed = Date.now() - start;
    console.log(`耗时: ${elapsed}ms`);
    console.log(`timedOut: ${result.timedOut}`);
    console.log(`exitCode: ${result.exitCode}`);
    console.log(`stderr 包含超时提示: ${result.stderr.includes("进程超时")}`);

    // 验证
    const pass = result.timedOut === true && elapsed < 5000 && result.stderr.includes("进程超时");
    console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
    return pass;
  } catch (error) {
    console.log(`异常: ${error}`);
    return false;
  }
}

async function testProcessAbort() {
  console.log("\n=== 测试 2: 进程取消 ===");
  const start = Date.now();
  const controller = new AbortController();

  // 1 秒后取消
  setTimeout(() => controller.abort(), 1000);

  try {
    const result = await runProcess({
      command: "node",
      args: ["-e", "setTimeout(() => console.log('done'), 10000)"],
      cwd: process.cwd(),
      signal: controller.signal,
    });

    const elapsed = Date.now() - start;
    console.log(`耗时: ${elapsed}ms`);
    console.log(`aborted: ${result.aborted}`);
    console.log(`exitCode: ${result.exitCode}`);

    const pass = result.aborted === true && elapsed < 3000;
    console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
    return pass;
  } catch (error) {
    console.log(`异常: ${error}`);
    return false;
  }
}

async function testProcessNormal() {
  console.log("\n=== 测试 3: 正常进程 ===");

  try {
    const result = await runProcess({
      command: "echo",
      args: ["hello"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    console.log(`stdout: ${result.stdout.trim()}`);
    console.log(`timedOut: ${result.timedOut}`);
    console.log(`aborted: ${result.aborted}`);
    console.log(`exitCode: ${result.exitCode}`);

    const pass = result.stdout.trim() === "hello" && !result.timedOut && !result.aborted && result.exitCode === 0;
    console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
    return pass;
  } catch (error) {
    console.log(`异常: ${error}`);
    return false;
  }
}

async function testProcessTreeKill() {
  console.log("\n=== 测试 4: 进程树清理 ===");
  const start = Date.now();

  try {
    // 创建一个会 fork 子进程的脚本
    const result = await runProcess({
      command: "node",
      args: [
        "-e",
        `
        const { spawn } = require('child_process');
        const child = spawn('node', ['-e', 'setTimeout(() => {}, 10000)'], { detached: true });
        setTimeout(() => {}, 10000);
        `,
      ],
      cwd: process.cwd(),
      timeoutMs: 2000,
    });

    const elapsed = Date.now() - start;
    console.log(`耗时: ${elapsed}ms`);
    console.log(`timedOut: ${result.timedOut}`);

    const pass = result.timedOut === true && elapsed < 5000;
    console.log(`结果: ${pass ? "✅ PASS" : "❌ FAIL"}`);
    return pass;
  } catch (error) {
    console.log(`异常: ${error}`);
    return false;
  }
}

async function main() {
  console.log("开始测试进程管理...\n");

  const results = [
    await testProcessTimeout(),
    await testProcessAbort(),
    await testProcessNormal(),
    await testProcessTreeKill(),
  ];

  const passed = results.filter(Boolean).length;
  console.log(`\n=== 测试完成: ${passed}/${results.length} 通过 ===`);

  if (passed < results.length) {
    process.exit(1);
  }
}

main().catch(console.error);
