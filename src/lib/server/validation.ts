import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  path: z.string().trim().min(1),
});

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  parentTaskId: z.string().uuid().nullable().optional(),
  prompt: z.string().trim().min(1).max(12000),
  mode: z.enum(["collaborative", "codexOnly", "claudeOnly", "custom"]),
  targetAgent: z.enum(["claude", "codex", "custom"]).nullable().optional(),
  budget: z.enum(["low", "standard", "high"]),
  permission: z.enum(["readOnly", "workspaceWrite", "fullAccess"]),
  memoryMode: z.enum(["off", "taskSummary", "projectMemory"]).optional(),
  contextPolicy: z.string().trim().min(1).max(120).optional(),
});

export const createTaskMessageSchema = z.object({
  content: z.string().trim().min(1).max(12000),
  includeInContext: z.boolean().optional(),
});

export const continueTaskSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("wait"),
  }),
  z.object({
    action: z.literal("derive"),
    prompt: z.string().trim().min(1).max(12000),
    mode: z.enum(["collaborative", "codexOnly", "claudeOnly", "custom"]),
    targetAgent: z.enum(["claude", "codex", "custom"]).nullable().optional(),
    budget: z.enum(["low", "standard", "high"]),
    permission: z.enum(["readOnly", "workspaceWrite", "fullAccess"]),
    includeMessages: z.boolean().optional(),
  }),
]);

export const switchAgentSchema = z.object({
  agent: z.enum(["claude", "codex"]),
});
