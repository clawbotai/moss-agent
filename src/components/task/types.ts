import type { TaskLog, TaskMessage, TaskStage, TaskWithRelations } from "@/lib/types";

export interface TaskDetailProps {
  task: TaskWithRelations | null;
}

export type DerivedLogKind = "event" | "agent-output" | "warning" | "error";

export type ConversationQuestion = {
  key: string;
  content: string;
  createdAt: string;
  includeInContext?: boolean;
};

export type CollaborationEntry =
  | {
      type: "stage";
      key: string;
      at: number;
      order: number;
      stage: TaskStage;
    }
  | {
      type: "message";
      key: string;
      at: number;
      order: number;
      message: TaskMessage;
    }
  | {
      type: "error";
      key: string;
      at: number;
      order: number;
      errorMessage: string;
      status: string;
    };

export type AnswerEntry =
  | {
      type: "summary";
      key: string;
      at: number;
      order: number;
      summary: string;
    }
  | {
      type: "message";
      key: string;
      at: number;
      order: number;
      message: TaskMessage;
    };

export type ConversationTurn = {
  key: string;
  question: ConversationQuestion;
  collaboration: CollaborationEntry[];
  answers: AnswerEntry[];
};

export const VALID_STAGE_STATUSES = new Set(["queued", "running", "completed", "failed", "waiting", "skipped", "cancelled"]);
