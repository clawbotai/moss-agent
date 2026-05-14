import { execFileSync } from "node:child_process";

const checks = [
  ["node", ["--version"]],
  ["pnpm", ["--version"]],
  [process.env.MOSS_CODEX_BIN || "codex", ["--version"]],
  [process.env.MOSS_CLAUDE_BIN || "claude", ["--version"]],
];

for (const [bin, args] of checks) {
  try {
    const output = execFileSync(bin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    console.log(`ok ${bin}: ${output || "available"}`);
  } catch (error) {
    console.log(`missing ${bin}: ${(error && error.message) || "not found"}`);
  }
}
