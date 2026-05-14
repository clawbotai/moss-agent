import type { AgentAdapter, AgentRunContext } from "@/lib/agents/types";
import type { AgentId } from "@/lib/types";
import { claudeAdapter } from "@/lib/agents/claude";
import { codexAdapter } from "@/lib/agents/codex";

const customAdapter: AgentAdapter = {
  id: "custom",
  label: "自定义 Agent",
  async detect() {
    return {
      id: "custom",
      label: "自定义 Agent",
      available: false,
      command: "未配置",
      version: null,
      message: "自定义 agent 适配器尚未配置",
    };
  },
  async run() {
    return { ok: false, summary: "自定义 agent 尚未配置", exitCode: null };
  },
  async review() {
    return { ok: false, summary: "自定义 agent 尚未配置", exitCode: null };
  },
};

const adapters = new Map<AgentId, AgentAdapter>([
  ["claude", claudeAdapter],
  ["codex", codexAdapter],
  ["custom", customAdapter],
]);

export function getAgent(id: AgentId) {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`未知 agent：${id}`);
  return adapter;
}

export async function detectAgents() {
  return Promise.all(Array.from(adapters.values()).map((adapter) => adapter.detect()));
}

export function buildAgentContext(
  base: Omit<AgentRunContext, "onLog">,
  onLog: AgentRunContext["onLog"],
) {
  return { ...base, onLog };
}
