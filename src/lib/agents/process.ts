import { spawn } from "node:child_process";
import path from "node:path";

// 允许的命令白名单
const ALLOWED_COMMANDS = new Set([
  'claude', 'codex', 'node', 'pnpm', 'npm', 'npx', 'yarn', 'bun',
  'git', 'grep', 'find', 'ls', 'cat', 'echo', 'which', 'where'
]);

const DEFAULT_TIMEOUT_MS = Number(process.env.MOSS_DEFAULT_TIMEOUT_MS) || 30 * 60 * 1000; // 30 分钟
const SIGKILL_GRACE_MS = Number(process.env.MOSS_SIGKILL_GRACE_MS) || 5000; // 5 秒

function validateCommand(command: string) {
  const basename = path.basename(command);
  if (!ALLOWED_COMMANDS.has(basename)) {
    throw new Error(`不允许执行的命令: ${basename}`);
  }
}

/**
 * 终止进程树：先 SIGTERM，grace 时间后 SIGKILL
 *
 * 注意：detached 模式下，-pid 会杀掉整个进程组。
 * 如果 CLI 工具（如 claude/codex）创建了自己的子进程组，
 * 可能无法完全清理所有子进程。这种情况下需要外部工具（如 tree-kill）。
 */
function terminateProcessTree(child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean }, signal: NodeJS.Signals = "SIGTERM") {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform !== "win32") {
    // Unix: kill 进程组（负 PID）
    try {
      process.kill(-pid, signal);
    } catch {
      // 进程已退出或不是进程组 leader，fallback 到直接 kill
      try { child.kill(signal); } catch { /* ignore */ }
    }
  } else {
    // Windows: 使用 taskkill 清理进程树
    try {
      const { execSync } = require("node:child_process");
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
    } catch {
      // taskkill 失败，fallback 到直接 kill
      try { child.kill(signal); } catch { /* ignore */ }
    }
  }
}

export async function commandExists(command: string, args = ["--version"]) {
  try {
    const result = await runProcess({
      command,
      args,
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    return {
      available: result.exitCode === 0,
      output: `${result.stdout}\n${result.stderr}`.trim(),
    };
  } catch (error) {
    return {
      available: false,
      output: error instanceof Error ? error.message : "命令不可用",
    };
  }
}

export async function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}) {
  validateCommand(options.command);

  const effectiveTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32", // Unix 下创建进程组
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let aborted = false;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let exited = false;

  // 监听进程退出，标记 exited 状态
  child.once("exit", () => {
    exited = true;
  });

  // 超时处理：SIGTERM -> grace -> SIGKILL
  const timeout = setTimeout(() => {
    if (exited) return; // 进程已退出，跳过
    timedOut = true;
    terminateProcessTree(child, "SIGTERM");
    killTimer = setTimeout(() => {
      if (!exited) {
        try { terminateProcessTree(child, "SIGKILL"); } catch { /* 进程已退出 */ }
      }
    }, SIGKILL_GRACE_MS);
  }, effectiveTimeoutMs);

  // abort 处理（用户取消）
  const abort = () => {
    if (exited) return; // 进程已退出，跳过
    aborted = true;
    terminateProcessTree(child, "SIGTERM");
    killTimer = setTimeout(() => {
      if (!exited) {
        try { terminateProcessTree(child, "SIGKILL"); } catch { /* 进程已退出 */ }
      }
    }, SIGKILL_GRACE_MS);
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  child.stdout.on("data", (data: Buffer) => {
    const chunk = data.toString();
    stdout += chunk;
    options.onStdout?.(chunk);
  });

  child.stderr.on("data", (data: Buffer) => {
    const chunk = data.toString();
    stderr += chunk;
    options.onStderr?.(chunk);
  });

  // stdin 写入前检查进程是否已退出
  if (options.stdin && !child.stdin.destroyed) {
    child.stdin.end(options.stdin);
  } else {
    child.stdin.end();
  }

  let exitResult: { exitCode: number | null; signal: NodeJS.Signals | null };
  try {
    exitResult = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
      },
    );
  } finally {
    clearTimeout(timeout);
    if (killTimer) clearTimeout(killTimer);
    options.signal?.removeEventListener("abort", abort);
  }

  // 超时时追加提示
  if (timedOut) {
    stderr += `\n[MOSS] 进程超时 (${effectiveTimeoutMs / 1000}s)，已被终止`;
  }

  return {
    stdout,
    stderr,
    exitCode: exitResult.exitCode,
    signal: exitResult.signal,
    timedOut,
    aborted,
  };
}
