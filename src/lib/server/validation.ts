import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  path: z.string().trim().min(1),
});

export const createTaskSchema = z
  .object({
    projectId: z.string().uuid(),
    parentTaskId: z.string().uuid().nullable().optional(),
    prompt: z.string().trim().min(1).max(12000),
    mode: z.enum(["collaborative", "codexOnly", "claudeOnly", "custom"]),
    targetAgent: z.enum(["claude", "codex", "custom"]).nullable().optional(),
    budget: z.enum(["low", "standard", "high"]),
    permission: z.enum(["readOnly", "workspaceWrite", "fullAccess"]),
  })
  .strict();

export const projectSettingsSchema = z
  .object({
    memoryInjectEnabled: z.boolean().optional(),
    memoryExtractEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.memoryInjectEnabled !== undefined || value.memoryExtractEnabled !== undefined,
    "至少需要提供一个设置项",
  );

export const createTaskMessageSchema = z.object({
  content: z.string().trim().min(1).max(12000),
  includeInContext: z.boolean().optional(),
  mode: z.enum(["collaborative", "codexOnly", "claudeOnly", "custom"]).optional(),
});

export const switchAgentSchema = z.object({
  agent: z.enum(["claude", "codex"]),
});
