// ─── Init ────────────────────────────────────────────────
export { getDb, closeDb } from "./init";

// ─── Projects ────────────────────────────────────────────
export {
  createProject,
  listProjects,
  getProject,
  getProjectByPath,
  getProjectSettings,
  upsertProjectSettings,
} from "./projects";

// ─── Skill Selection ────────────────────────────────────
export { serializeSkillSelection, parseSkillSelection } from "./skill-selection";

// ─── Tasks ───────────────────────────────────────────────
export {
  createTask,
  listTasks,
  getTask,
  getTaskWithRelations,
  updateTaskStatus,
  setPendingMode,
  applyTaskMode,
  applyTaskModeAndSkills,
  confirmTaskWithMessage,
  resetTaskForRetry,
  getParentTaskId,
  getTaskDeriveOptions,
  getRecoverableTasks,
  enumValues,
} from "./tasks";

// ─── Stages & Logs ───────────────────────────────────────
export {
  createStages,
  listStages,
  updateStage,
  appendLog,
  listLogs,
} from "./stages-logs";

// ─── Resources ───────────────────────────────────────────
export {
  createTaskMessage,
  listTaskMessages,
  createContextSnapshot,
  listContextSnapshots,
  createArtifact,
  listArtifacts,
  createAgentRun,
  completeAgentRun,
  listAgentRuns,
  getLatestAgentRunForStage,
  createAgentMessage,
  listAgentMessages,
} from "./resources";
