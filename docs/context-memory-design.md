# MOSS-Agent 上下文与记忆系统设计方案

> 本方案遵循 [think.md](./think.md) 设计原则：任务优先、结构化交接、显式隔离、渐进增强。

## 背景

当前系统已有基础的上下文打包和阶段摘要传递能力，但在以下方面存在不足：

1. **项目记忆是占位符** — 无法复用历史项目的上下文
2. **Context 平等对待所有阶段** — 不同阶段需要不同侧重点
3. **Agent 间传递信息单一** — review/audit 看不到变更范围
4. **派生任务无精细控制** — 无法选择继承哪些上下文
5. **缺少产物和运行审计** — 阶段输出、CLI 调用无独立记录

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Context Builder                         │
│  buildContextPackage(taskId, stageId)                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Stage Router│→ │Memory Search │→ │ Change Scope Gen │  │
│  │ (per-role)  │  │ (projectMem) │  │ (git diff/stat) │  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
│           ↓             ↓                  ↓               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Context Sections (weighted)                │   │
│  │  metadata | prompt | stages | memory | changes | msgs │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                │
│              MAX_CONTEXT_CHARS (12000) → truncate           │
└─────────────────────────────────────────────────────────────┘
```

---

## 0. 基础模型补充（think.md §5）

在扩展上下文系统之前，先补齐 think.md 建议的三个基础模型。

### 0.1 Artifacts — 产物独立管理

阶段摘要不再承担产物存储职责，计划、审查意见、diff、测试报告独立建表。

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  stageId TEXT,
  type TEXT NOT NULL,          -- 'plan' | 'review' | 'diff' | 'test' | 'summary' | 'handoff' | 'report'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  filePath TEXT,
  metadataJson TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(stageId) REFERENCES task_stages(id) ON DELETE SET NULL
);

CREATE INDEX idx_artifacts_task ON artifacts(taskId);
CREATE INDEX idx_artifacts_stage ON artifacts(stageId);
```

```typescript
export type ArtifactType = "plan" | "review" | "diff" | "test" | "summary" | "handoff" | "report";

export interface Artifact {
  id: string;
  taskId: string;
  stageId: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  filePath: string | null;
  metadataJson: string | null;
  createdAt: string;
}
```

用途：
- 计划文档不再只塞进 stage output，可独立渲染和下载。
- 审查意见作为 review artifact，成为任务故事线的一部分。
- 后续导出任务包时有稳定来源。

### 0.2 Agent Messages — Agent 间结构化通信

用户补充说明继续走 `task_messages`；agent 之间的交接、阻塞、审查意见单独建模。

```sql
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  stageId TEXT,
  fromAgent TEXT NOT NULL,     -- 'claude' | 'codex' | 'custom' | 'system'
  toAgent TEXT NOT NULL,       -- 'claude' | 'codex' | 'custom' | 'system' | 'user'
  intent TEXT NOT NULL,        -- 'clarification' | 'review_comment' | 'blocked' | 'status_update' | 'fix_request'
  content TEXT NOT NULL,
  artifactId TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(stageId) REFERENCES task_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(artifactId) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE INDEX idx_agent_messages_task ON agent_messages(taskId);
```

```typescript
export type AgentMessageIntent = "clarification" | "review_comment" | "blocked" | "status_update" | "fix_request";

export interface AgentMessage {
  id: string;
  taskId: string;
  stageId: string | null;
  fromAgent: "claude" | "codex" | "custom" | "system";
  toAgent: "claude" | "codex" | "custom" | "system" | "user";
  intent: AgentMessageIntent;
  content: string;
  artifactId: string | null;
  createdAt: string;
}
```

原则：
- 进入 prompt 前必须压缩成摘要，不直接传递原始消息。
- 可长期保留，用于任务故事线渲染。

### 0.3 Agent Runs — CLI 调用审计

记录每次 CLI 调用，支撑排查、预算统计和阶段重试。

```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  taskId TEXT NOT NULL,
  stageId TEXT NOT NULL,
  agent TEXT NOT NULL,
  command TEXT NOT NULL,
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  exitCode INTEGER,
  tokenEstimate INTEGER,
  errorMessage TEXT,
  FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY(stageId) REFERENCES task_stages(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_runs_task ON agent_runs(taskId);
CREATE INDEX idx_agent_runs_stage ON agent_runs(stageId);
```

```typescript
export interface AgentRun {
  id: string;
  taskId: string;
  stageId: string;
  agent: "claude" | "codex" | "custom";
  command: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  tokenEstimate: number | null;
  errorMessage: string | null;
}
```

---

## 1. 项目记忆系统

### 原则（think.md §7.3）

> 项目记忆不应该直接保存流水日志。只保存：架构约定、长期偏好、关键技术决策、常用验证命令、重要风险和踩坑结论。**项目记忆应有确认入口，不应自动无限追加。**

### 设计

**新增表：`project_memory`**

```sql
CREATE TABLE project_memory (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  category TEXT NOT NULL,          -- 'architecture' | 'decision' | 'convention' | 'issue' | 'context'
  content TEXT NOT NULL,
  source TEXT NOT NULL,            -- 'auto' | 'manual'
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'confirmed' — 自动提取的默认为草稿
  taskId TEXT,
  tags TEXT,                       -- JSON array: ["react", "auth", "perf"]
  createdAt TEXT NOT NULL,
  confirmedAt TEXT,
  FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(taskId) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_memory_project_category ON project_memory(projectId, category);
CREATE INDEX idx_memory_project_status ON project_memory(projectId, status);
```

**新增类型**

```typescript
export type MemoryCategory = "architecture" | "decision" | "convention" | "issue" | "context";
export type MemoryStatus = "draft" | "confirmed";

export interface ProjectMemory {
  id: string;
  projectId: string;
  category: MemoryCategory;
  content: string;
  source: "auto" | "manual";
  status: MemoryStatus;
  taskId: string | null;
  tags: string[];
  createdAt: string;
  confirmedAt: string | null;
}
```

**核心规则：自动提取 → 草稿 → 用户确认**

```typescript
// src/lib/server/memory.ts

// ⚠️ 自动提取：任务完成后生成草稿记忆，不直接持久化为 confirmed
// 注意：当前正则规则较粗糙，建议后续增加 LLM 抽取或权重系数验证
export function extractMemoryFromTask(task: TaskWithRelations): ProjectMemory[] {
  const memories: ProjectMemory[] = [];
  const summary = task.summary || "";
  const matchedPatterns: string[] = [];

  // 架构决策：匹配多个关键词才提取
  if (/技术选型|架构设计/.test(summary)) matchedPatterns.push("architecture");
  if (/决定|选型|方案/.test(summary)) matchedPatterns.push("decision");

  // 代码规范：从 implement 阶段输出提取
  const implStages = task.stages.filter(s => s.role === "implement" && s.outputSummary);
  if (implStages.length > 0) matchedPatterns.push("convention");

  // 问题记录：匹配问题关键词
  if (/问题|bug|风险|缺陷|修复/.test(summary)) matchedPatterns.push("issue");

  // 只有匹配 2 个以上模式才提取，避免误判
  if (matchedPatterns.length >= 2) {
    memories.push(createProjectMemory({
      projectId: task.projectId,
      category: "architecture",
      content: summary.slice(0, 2000),
      source: "auto",
      status: "draft",
      taskId: task.id,
    }));
  }

  return memories;
}

// 用户确认：将草稿升级为 confirmed
export function confirmMemory(memoryId: string): ProjectMemory {
  const db = getDb();
  db.prepare(`
    UPDATE project_memory SET status = 'confirmed', confirmedAt = ? WHERE id = ?
  `).run(nowIso(), memoryId);
  return getProjectMemory(memoryId);
}

// 批量确认
export function confirmMemories(memoryIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE project_memory SET status = 'confirmed', confirmedAt = ? WHERE id = ?`);
  const now = nowIso();
  const tx = db.transaction(() => {
    for (const id of memoryIds) stmt.run(now, id);
  });
  tx();
}

// 拒绝/删除草稿
export function rejectMemory(memoryId: string): void {
  getDb().prepare(`DELETE FROM project_memory WHERE id = ? AND status = 'draft'`).run(memoryId);
}

// 检索：只返回已确认的记忆
export function searchProjectMemory(
  projectId: string,
  options: { query?: string; categories?: MemoryCategory[]; limit?: number; tags?: string[] } = {}
): ProjectMemory[] {
  const { query, categories, limit = 10, tags } = options;
  let sql = "SELECT * FROM project_memory WHERE projectId = ? AND status = 'confirmed'";
  const params: unknown[] = [projectId];

  if (categories?.length) {
    sql += ` AND category IN (${categories.map(() => "?").join(",")})`;
    params.push(...categories);
  }
  if (tags?.length) {
    for (const tag of tags) {
      sql += ` AND tags LIKE ?`;
      params.push(`%"${tag}"%`);
    }
  }
  sql += " ORDER BY createdAt DESC LIMIT ?";
  params.push(limit);

  const rows = getDb().prepare(sql).all(...params) as Array<ProjectMemory & { tags: string }>;
  return rows.map(row => ({ ...row, tags: JSON.parse(row.tags) }));
}

// 获取待确认的草稿
export function getPendingMemories(projectId: string): ProjectMemory[] {
  const rows = getDb().prepare(`
    SELECT * FROM project_memory WHERE projectId = ? AND status = 'draft' ORDER BY createdAt DESC
  `).all(projectId) as Array<ProjectMemory & { tags: string }>;
  return rows.map(row => ({ ...row, tags: JSON.parse(row.tags) }));
}
```

**API 端点**

```
GET  /api/projects/:projectId/memory?status=draft|confirmed   — 查询记忆
POST /api/projects/:projectId/memory                          — 手动创建（直接 confirmed）
POST /api/projects/:projectId/memory/confirm                  — 批量确认草稿
DELETE /api/projects/:projectId/memory/:memoryId              — 删除记忆
```

**UI：任务完成后的记忆确认**

任务完成后，如果有自动提取的草稿记忆，UI 弹出确认面板：
- 列出每条草稿，显示分类标签和内容预览
- 用户可逐条确认、编辑或删除
- 确认后的记忆才进入后续任务的上下文包

**修改 `context.ts` 的 memorySection**

```typescript
// ⚠️ 注意：使用静态 import，避免 ESM/CommonJS 混用问题
import { searchProjectMemory } from "@/lib/server/memory";

function memorySection(memoryMode: MemoryMode, projectId: string, taskPrompt: string) {
  if (memoryMode === "off") return "## 项目记忆\n已关闭。";

  if (memoryMode === "projectMemory") {
    const relevant = searchProjectMemory(projectId, {
      query: taskPrompt,
      categories: ["architecture", "decision", "convention", "issue"],
      limit: 5,
    });

    if (!relevant.length) return "## 项目记忆\n已开启，当前无相关记忆。";

    const sections = relevant.map(m =>
      `### [${m.category}] ${m.source === "auto" ? `(来自任务 ${m.taskId})` : "(手动)"}\n${trimSection(m.content)}`
    );
    return `## 项目记忆\n${sections.join("\n\n")}`;
  }

  return "## 项目记忆\n仅使用本任务压缩摘要。";
}
```

---

## 2. Context 按阶段动态调整

### 原则（think.md §3.3）

> 每个阶段只接收：上下文包 + 上一阶段摘要 + 必要 artifact 引用 + 当前阶段目标。

### 设计

**阶段权重配置（可调优）**

权重配置写入配置文件，用户可调：

```typescript
// .moss-agent/config.json
{
  "contextWeights": {
    "plan": { "prompt": 0.4, "stages": 0.0, "memory": 0.2, "messages": 0.1, "parentContext": 0.2, "summary": 0.1 },
    "review": { "prompt": 0.15, "stages": 0.25, "memory": 0.1, "messages": 0.1, "parentContext": 0.0, "summary": 0.1, "review": 0.3 },
    // ...
  }
}
```

```typescript
// src/lib/server/context.ts

// 从配置文件加载权重，支持热更新
let STAGE_WEIGHTS: Record<StageRole, Record<string, number>> = { ... };

export function loadContextWeights() {
  try {
    const configPath = path.join(getDataDir(), "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.contextWeights) {
        STAGE_WEIGHTS = { ...STAGE_WEIGHTS, ...config.contextWeights };
      }
    }
  } catch {
    // 使用默认权重
  }
}

// 每个阶段完成后记录 token 使用量，用于后续调优建议
export function recordContextTokenUsage(stageId: string, tokenEstimate: number) {
  // 写入 logs 表或新建 context_metrics 表，用于分析权重配置是否合理
}
```

**实施顺序建议**

权重初期按经验值配置，运行一段时间后根据 `task_context_snapshots.tokenEstimate` 分析：
- 哪些阶段经常被截断 → 增加权重
- 哪些阶段 token 有大量剩余 → 降低权重或增加其他 section

**构建上下文包**

```typescript
function buildContextPackage(taskId: string, options: ContextPackageOptions = {}): ContextPackage {
  const task = options.task ?? getTaskWithRelations(taskId);
  if (!task) throw new Error("任务不存在");

  const stage = task.stages.find(s => s.id === options.stageId);
  const role = stage?.role || "summarize";
  const weights = STAGE_WEIGHTS[role] || STAGE_WEIGHTS.summarize;

  const quotas = {
    prompt: Math.floor(MAX_TOTAL_CHARS * (weights.prompt || 0)),
    stages: Math.floor(MAX_TOTAL_CHARS * (weights.stages || 0)),
    memory: Math.floor(MAX_TOTAL_CHARS * (weights.memory || 0)),
    messages: Math.floor(MAX_TOTAL_CHARS * (weights.messages || 0)),
    parentContext: Math.floor(MAX_TOTAL_CHARS * (weights.parentContext || 0)),
    summary: Math.floor(MAX_TOTAL_CHARS * (weights.summary || 0)),
    review: Math.floor(MAX_TOTAL_CHARS * (weights.review || 0)),
    changes: Math.floor(MAX_TOTAL_CHARS * (weights.changes || 0)),
  };

  const sections: Array<{ name: string; content: string }> = [
    { name: "## 隔离策略", content: metadataSection(task) },
    { name: "## 用户原始需求", content: promptSection(task, quotas.prompt) },
  ];

  if (weights.parentContext > 0) {
    sections.push({ name: "## 父任务上下文", content: parentContextSection(task, quotas.parentContext) });
  }
  if (weights.stages > 0) {
    sections.push({ name: "## 阶段摘要", content: stagesSection(task.stages, quotas.stages) });
  }
  if (weights.review > 0) {
    sections.push({ name: "## 审查结论", content: reviewSection(task.stages, quotas.review) });
  }
  if (weights.summary > 0) {
    sections.push({ name: "## 交付摘要", content: summarySection(task, quotas.summary) });
  }
  if (weights.messages > 0) {
    sections.push({ name: "## 当前任务消息", content: messagesSection(task, quotas.messages) });
  }

  sections.push({ name: "## 项目记忆", content: memorySection(task.memoryMode, task.projectId, task.prompt, quotas.memory) });

  if (weights.changes > 0) {
    sections.push({ name: "## 变更范围", content: changesSection(task, quotas.changes) });
  }

  if (options.extraInstruction) {
    sections.push({ name: "## 本次补充指令", content: trimSection(options.extraInstruction) });
  }

  const joined = sections.map(s => s.name + "\n" + s.content).join("\n\n");
  const content = clamp(joined, MAX_TOTAL_CHARS);

  return {
    policy: task.contextPolicy,
    memoryMode: task.memoryMode,
    content,
    tokenEstimate: estimateTokens(content),
  };
}
```

---

## 3. Agent 间传递变更范围

### 原则

`implement` 和 `audit` 阶段需要知道具体代码变更范围，但只传递结构化摘要，不传递完整 diff。

### 设计

```typescript
// src/lib/server/changes.ts

export interface ChangeScope {
  files: string[];
  insertions: number;
  deletions: number;
  diffStat: string;
  keyFiles: string[];
  summary: string;
}

// ⚠️ 注意：复用 process.ts 的 runProcess，避免重复封装
import { runProcess } from "@/lib/agents/process";

export async function generateChangeScope(projectPath: string): Promise<ChangeScope | null> {
  try {
    const result = await runProcess({
      command: "git",
      args: ["diff", "--stat", "--numstat"],
      cwd: projectPath,
      timeoutMs: 5000,
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null; // 非 git 仓库或无变更
    }

    const files: string[] = [];
    let insertions = 0;
    let deletions = 0;

    for (const line of result.stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const [ins, del, ...fileParts] = parts;
        if (ins !== "-" && ins !== "BINARY") {
          insertions += parseInt(ins) || 0;
          deletions += parseInt(del) || 0;
          files.push(fileParts.join(" "));
        }
      }
    }

    return {
      files,
      insertions,
      deletions,
      diffStat: result.stdout,
      keyFiles: files.slice(0, 10),
      summary: `${files.length} 个文件变更 (+${insertions} -${deletions})`,
    };
  } catch {
    return null; // git 命令不可用或执行失败
  }
}
```

**在 context 中集成**

```typescript
function changesSection(task: TaskWithRelations, changeScope: ChangeScope | null, maxChars: number): string {
  if (!changeScope) return "## 变更范围\n暂无变更信息。";

  const content = [
    `### 统计\n${changeScope.summary}`,
    `### 变更文件\n${changeScope.files.slice(0, 20).map(f => `- ${f}`).join("\n")}`,
    changeScope.files.length > 20 ? `\n... 还有 ${changeScope.files.length - 20} 个文件` : "",
  ].filter(Boolean).join("\n\n");

  return `## 变更范围\n${trimSection(content, maxChars)}`;
}
```

---

## 4. 派生任务精细控制

### 原则（think.md §3.2）

> 派生任务只继承摘要、审查结论、失败原因和用户显式选择的上下文块。

### 设计

**派生选项类型**

```typescript
export interface DeriveOptions {
  inheritStages: "completed" | "lastN" | number;  // ← 移除 "all"，不允许全量继承
  inheritMessages: boolean;                         // 默认 false
  contextScope: "minimal" | "standard" | "full";
  includeParentSummary: boolean;                    // 默认 true
}

export const DERIVE_OPTIONS_DEFAULTS: DeriveOptions = {
  inheritStages: "completed",
  inheritMessages: false,
  contextScope: "standard",
  includeParentSummary: true,
};
```

**修改 `parentContextSection`**

```typescript
function parentContextSection(task: TaskWithRelations, maxChars: number) {
  if (!task.parentTaskId) return "";

  const parent = getTaskWithRelations(task.parentTaskId);
  if (!parent) {
    return "## 父任务上下文\n父任务不存在或已被删除，仅保留派生关系标记。";
  }

  const deriveOptions = getTaskDeriveOptions(task.id);
  const options = deriveOptions || DERIVE_OPTIONS_DEFAULTS;

  // 控制继承哪些阶段 — 只传摘要，不传完整输出
  let stagesToInclude = parent.stages.filter(s => s.status === "completed");
  if (options.inheritStages === "lastN" || typeof options.inheritStages === "number") {
    const n = typeof options.inheritStages === "number" ? options.inheritStages : 1;
    stagesToInclude = stagesToInclude.slice(-n);
  }

  const sections = [
    "## 父任务上下文",
    `父任务：${parent.title}`,
    `上下文范围：${options.contextScope}`,
  ];

  if (options.includeParentSummary) {
    sections.push(`### 父任务交付摘要\n${trimSection(parent.summary || "暂无")}`);
  }

  // 只传摘要，不传完整 outputSummary
  if (stagesToInclude.length) {
    sections.push(`### 继承的阶段摘要\n${stagesToInclude.map((s, i) =>
      `${i + 1}. ${s.name}（${s.agent}/${s.role}）：${trimSection(s.outputSummary || "", 300)}`
    ).join("\n")}`);
  }

  if (options.inheritMessages) {
    const selected = parent.messages.filter(m => m.includeInContext);
    if (selected.length) {
      sections.push(`### 继承的消息\n${selected.map((m, i) =>
        `${i + 1}. ${m.role}：${trimSection(m.content)}`
      ).join("\n")}`);
    }
  }

  return trimSection(sections.join("\n\n"), maxChars);
}
```

---

## 5. SSE 实时日志

### 原则（think.md §9）

> 卡住检测应从"阶段运行时间过长"升级为"长时间无新输出"。每次 `onLog` 输出后刷新无输出计时器。

### 设计

**SSE 路由**（已有，补充心跳和重连）

```typescript
// src/app/api/tasks/[taskId]/events/route.ts

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const scheduler = getScheduler();
      const unsubscribe = scheduler.subscribe(taskId, (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      });

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: heartbeat\n\n`)); }
        catch { clearInterval(heartbeat); }
      }, 30000);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}
```

**前端 Hook**

```typescript
// src/hooks/useTaskSSE.ts

export function useTaskSSE(taskId: string | null, onEvent: (event: TaskEvent) => void) {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) return;

    // ⚠️ 注意：重连时需要更新 ref，否则断开的连接会孤立在内存中
    const connect = () => {
      const es = new EventSource(`/api/tasks/${taskId}/events`);
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        try { onEvent(JSON.parse(e.data)); } catch { /* ignore */ }
      };

      es.onerror = () => {
        es.close();
        // 重连时更新 ref，防止旧连接泄漏
        eventSourceRef.current = null;
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [taskId, onEvent]);
}
```

**降级策略**：保留轮询作为 SSE 不可用时的 fallback，轮询间隔 5 秒。

---

## 6. 日志结构升级说明

遵循 think.md §7.4：

> 当前交互阶段先用前端派生分类处理日志阅读体验，不立即升级数据库结构。等任务详情交互稳定后，再升级数据库日志结构。

当前阶段：
- 从现有 `logs.level`、`logs.message`、`logs.stageId` 派生 UI 分类。
- 原始 stdout/stderr 继续落在 `logs`，不进入上下文包。

后续升级（任务详情交互稳定后）：
- `logs` 增加 `kind`、`stream`、`agentRunId`、`sequence`、`isKeyEvent` 等字段。
- 与 `agent_runs` 表关联，支持按次调用筛选日志。

---

## 涉及文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/types.ts` | 新增 `Artifact`, `AgentMessage`, `AgentRun`, `ProjectMemory`, `DeriveOptions` 类型 |
| `src/lib/server/db.ts` | 新增 `artifacts`, `agent_messages`, `agent_runs`, `project_memory` 表迁移 |
| `src/lib/server/memory.ts` | **新文件**：记忆 CRUD、自动提取（草稿）、确认/拒绝 |
| `src/lib/server/changes.ts` | **新文件**：`generateChangeScope`、`generateDiffPreview` |
| `src/lib/server/context.ts` | 阶段权重配置、`changesSection`、`parentContextSection` 增强 |
| `src/lib/server/scheduler.ts` | `runStage` 变 async、任务完成后调用 `extractMemoryFromTask`（生成草稿） |
| `src/app/api/projects/[projectId]/memory/route.ts` | 记忆 CRUD API |
| `src/app/api/tasks/[taskId]/events/route.ts` | SSE 心跳重连 |
| `src/hooks/useTaskSSE.ts` | SSE hook |
| `src/components/task/MemoryConfirm.tsx` | 记忆确认面板 |

---

## 实施顺序

遵循 think.md §13 的优先级：

### P0：巩固当前能力

1. 保持任务输入默认追加消息，不自动创建任务。
2. 保持派生任务只继承摘要和显式选择的上下文。
3. 将上下文包生成规则写入 README。

### P1：补 Artifact、Agent Run 审计与 Agent Messages

1. 新增 `artifacts` 表和 CRUD。
2. 新增 `agent_runs` 表，每次 CLI 调用写入记录。
3. 新增 `agent_messages` 表，review/audit 阶段写入结构化消息。
4. 每个阶段完成后写入标准 artifact（plan、review、diff、report）。
5. UI 任务故事线中渲染 artifact 附件。

### P2：Context 权重 + 变更范围 + SSE

1. 实现阶段权重配置和动态截断。
2. 实现 `changesSection`，集成 git diff stat。
3. 完善 SSE 心跳重连和日志游标。
4. 优化卡住检测（无输出 watchdog）。

### P3：项目记忆系统

1. 新增 `project_memory` 表。
2. 实现自动提取 → 草稿 → 用户确认流程。
3. 实现记忆检索，集成到 `memorySection`。
4. UI 记忆确认面板。

### P4：派生任务精细控制 + Harness

1. 实现 `DeriveOptions`，移除全量继承。
2. 重试当前阶段。
3. 失败原因分类。
4. 命令审计、危险命令提示、可选 worktree（think.md §10）。

---

## MVP 边界

遵循 think.md §12：

**当前 MVP 聚焦：**
- 多项目注册、同项目串行/不同项目并行
- 新任务、任务消息、派生任务分离
- Claude + Codex 协作模式 + 直接模式
- 阶段、日志、审查意见、上下文包、交付摘要可查看
- agent 环境诊断、卡住提示和人工操作

**暂不做：**
- 向量记忆系统（SQLite FTS5 等全文检索留作后续优化）
- 自动部署、自动 PR 合并
- 多人协作
- 无上限自动修复循环
- 默认 worktree 隔离

---

## 设计约束与已知限制

1. **Context 包上限 12000 chars** — 超出部分按权重比例截断，截断后显示 `...[已截断，避免上下文过长]`
2. **Git diff 在非 .git 仓库不可用** — `generateChangeScope` 返回 `null`，变更范围 section 返回空
3. **项目记忆检索仅支持 LIKE** — 暂不支持全文检索（SQLite FTS5 留作后续优化）
4. **SSE 不支持跨标签页共享** — 当前 `EventSource` 是页面级生命周期
5. **派生任务最大继承深度 3 层** — 超出后 `contextScope` 强制降级为 `minimal`
6. **记忆提取正则规则需调优** — 当前经验值可能产生误判，建议运行一段时间后根据草稿确认率调整

---

## 验证方式

1. **功能验证**：创建任务 → 观察各阶段 context 是否不同 → 检查日志流。
2. **记忆验证**：完成多个任务 → 确认草稿记忆 → 新任务引用已确认记忆。
3. **派生验证**：创建派生任务 → 确认只继承摘要而非全量内容。
4. **性能验证**：测量 token 消耗是否在预算内。
