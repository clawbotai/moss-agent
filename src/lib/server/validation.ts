import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  path: z.string().trim().min(1),
});

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(12000),
  mode: z.enum(["collaborative", "codexOnly", "claudeOnly", "custom"]),
  targetAgent: z.enum(["claude", "codex", "custom"]).nullable().optional(),
  budget: z.enum(["low", "standard", "high"]),
  permission: z.enum(["readOnly", "workspaceWrite", "fullAccess"]),
});
