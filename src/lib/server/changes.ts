import { runProcess } from "@/lib/agents/process";

export interface ChangeScope {
  files: string[];
  insertions: number;
  deletions: number;
  diffStat: string;
  keyFiles: string[];
  summary: string;
}

/**
 * 生成当前项目的变更范围信息
 * 通过 git diff --stat --numstat 获取
 * 如果非 git 仓库或无变更则返回 null
 */
export async function generateChangeScope(projectPath: string): Promise<ChangeScope | null> {
  try {
    const result = await runProcess({
      command: "git",
      args: ["diff", "--stat", "--numstat"],
      cwd: projectPath,
      timeoutMs: 5000,
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null;
    }

    const files: string[] = [];
    let insertions = 0;
    let deletions = 0;

    // 解析 --numstat 输出（在 --stat 之前）
    for (const line of result.stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const [ins, del, ...fileParts] = parts;
        if (ins !== "-" && del !== "-") {
          const insNum = parseInt(ins, 10);
          const delNum = parseInt(del, 10);
          if (!isNaN(insNum) && !isNaN(delNum)) {
            insertions += insNum;
            deletions += delNum;
            files.push(fileParts.join(" "));
          }
        }
      }
    }

    if (files.length === 0) return null;

    return {
      files,
      insertions,
      deletions,
      diffStat: result.stdout,
      keyFiles: files.slice(0, 10),
      summary: `${files.length} 个文件变更 (+${insertions} -${deletions})`,
    };
  } catch {
    return null;
  }
}
