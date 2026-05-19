import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/server/http";
import { filterSkillsByMode, listAvailableSkills } from "@/lib/server/skills";
import type { TaskMode } from "@/lib/types";

export const runtime = "nodejs";

const TASK_MODES: TaskMode[] = ["collaborative", "codexOnly", "claudeOnly", "custom"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const refresh = searchParams.get("refresh") === "1";
  const modeParam = searchParams.get("mode");
  if (modeParam && !TASK_MODES.includes(modeParam as TaskMode)) {
    return jsonError(new Error(`无效任务模式：${modeParam}`), 400);
  }
  const mode = modeParam as TaskMode | null;

  const allSkills = listAvailableSkills(refresh);
  const skills = mode ? filterSkillsByMode(allSkills, mode) : allSkills;

  const counts = {
    skills: skills.filter((s) => !s.builtin).length,
    plugins: 0,
  };

  return jsonOk({ skills, counts });
}
