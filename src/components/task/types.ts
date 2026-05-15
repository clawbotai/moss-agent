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

export type AnswerEntrySource = "agent-message" | "stage-summary" | "task-summary";

export type AnswerEntry = {
  key: string;
  at: number;
  order: number;
  content: string;
  createdAt: string;
  source: AnswerEntrySource;
};

export type ConversationTurn = {
  key: string;
  question: ConversationQuestion;
  collaboration: CollaborationEntry[];
  answers: AnswerEntry[];
};
