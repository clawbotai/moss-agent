import { spawn } from "node:child_process";
import path from "node:path";

// 允许的命令白名单
const ALLOWED_COMMANDS = new Set([
  'claude', 'codex', 'node', 'pnpm', 'npm', 'npx', 'yarn', 'bun',
  'git', 'grep', 'find', 'ls', 'cat', 'echo', 'which', 'where'
]);

function validateCommand(command: string) {
  const basename = path.basename(command);
  if (!ALLOWED_COMMANDS.has(basename)) {
    throw new Error(`不允许执行的命令: ${basename}`);
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
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const timeout =
    options.timeoutMs &&
    setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

  const abort = () => child.kill("SIGTERM");
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

  child.stdin.end(options.stdin);

  let exitResult: { exitCode: number | null; signal: NodeJS.Signals | null };
  try {
    exitResult = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
      },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }

  return {
    stdout,
    stderr,
    exitCode: exitResult.exitCode,
    signal: exitResult.signal,
    timedOut,
  };
}
