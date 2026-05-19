import { useState, useCallback } from "react";
import type { AgentSkill, TaskMode } from "@/lib/types";

interface UseSkillsReturn {
  skills: AgentSkill[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  filterByMode: (skills: AgentSkill[], mode: TaskMode) => AgentSkill[];
  fetchSkills: (refresh?: boolean) => Promise<void>;
}

export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh ? "/api/skills?refresh=1" : "/api/skills";
      const response = await fetch(url);
      if (!response.ok) throw new Error("加载技能列表失败");
      const data = await response.json();
      setSkills(data.skills);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载技能列表失败");
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchSkills(true);
  }, [fetchSkills]);

  const filterByMode = useCallback((skills: AgentSkill[], mode: TaskMode): AgentSkill[] => {
    if (mode === "custom") return skills.filter((s) => s.builtin);
    if (mode === "codexOnly") return skills.filter((s) => s.agent === "codex" || s.agent === "both" || s.builtin);
    if (mode === "claudeOnly") return skills.filter((s) => s.agent === "claude" || s.agent === "both" || s.builtin);
    return skills;
  }, []);

  return { skills, loading, error, refresh, filterByMode, fetchSkills };
}
