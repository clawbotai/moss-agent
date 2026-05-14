import { detectAgents } from "@/lib/agents/registry";
import { jsonError, jsonOk } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await detectAgents();
    const packageManagers = await detectPackageManagers();
    return jsonOk({ agents, packageManagers });
  } catch (error) {
    return jsonError(error);
  }
}

async function detectPackageManagers() {
  const { commandExists } = await import("@/lib/agents/process");
  const [pnpm, npm] = await Promise.all([
    commandExists("pnpm", ["--version"]),
    commandExists("npm", ["--version"]),
  ]);

  return [
    {
      id: "pnpm",
      available: pnpm.available,
      message: pnpm.available ? `pnpm 可用：${pnpm.output}` : "未找到 pnpm，建议先安装",
    },
    {
      id: "npm",
      available: npm.available,
      message: npm.available ? `npm 可用：${npm.output}` : "未找到 npm",
    },
  ];
}
