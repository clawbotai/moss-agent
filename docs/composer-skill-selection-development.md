# Composer Skill 选择与调用开发方案

## 背景

当前 composer 只支持选择执行模式、预算和权限：

- `collaborative`：Claude Code 与 Codex 协作
- `codexOnly`：Codex 直接开发
- `claudeOnly`：Claude Code 直接开发
- `custom`：自定义 agent

用户希望在 composer 中以类似 Claude Code 技能面板的形式查看和选择 skill，并让被选中的 skill 真正进入对应 Claude/Codex 执行链路。

本方案目标是补齐一条完整闭环：

1. composer 展示可用技能面板。
2. 用户可按 agent 选择 Claude 或 Codex skill。
3. 新建任务和同任务追加都持久化 skill 选择。
4. scheduler 将 skill 传给对应 agent 阶段。
5. Claude/Codex adapter 按各自能力调用或注入 skill。
6. 日志和阶段输入可追踪实际启用的 skill。

## 设计原则

1. **skill 不是 TaskMode**
   - `TaskMode` 仍只表达任务流程。
   - skill 是 agent 执行上下文，不能扩展成 `codexOnlyWithSkill` 这类组合模式。

2. **composer 保持收敛**
   - 不增加底部“新开任务 / 基于此任务继续”等分叉按钮。
   - 技能入口集成在输入框附近，和当前 composer 主语义保持一致。

3. **同任务追加必须继续执行**
   - 任务详情页发送仍走 `POST /api/tasks/[taskId]/messages`。
   - skill 选择需要随追加消息进入后续执行，而不是只保存 UI 状态。

4. **按 agent 隔离**
   - Claude 阶段只接收 Claude 可用 skill。
   - Codex 阶段只接收 Codex 可用 skill。
   - 协作模式允许分别指定 Claude/Codex skill。

5. **可见、可审计、可恢复**
   - stage inputSummary、任务日志、agent_runs command 或 metadata 中都要能看出启用了哪些 skill。
   - 超时重试和服务恢复后 skill 不丢失。

## 目标交互

### 入口

composer 输入框左侧增加一个技能按钮，视觉上接近终端命令入口：

```
┌─────────────────────────────────────────────────────────────┐
│  >_  输入提示词...（输入 / 查看技能）             📎  ✨  发送 │
└─────────────────────────────────────────────────────────────┘
```

触发方式：

- 点击左侧 `>_` 技能按钮。
- 在 textarea 中输入 `/` 时打开技能面板。
- 面板打开后输入内容用于搜索技能。

### 面板布局

面板浮在 composer 上方，样式参考目标截图：

```
┌─────────────────────────────────────────────────────────────┐
│ 技能  14                                      刷新           │
├─────────────────────────────────────────────────────────────┤
│ >_ Skills 14        插件 0                                  │
├─────────────────────────────────────────────────────────────┤
│ 内置命令                                                    │
│ * /compact   [instructions]                         内置    │
│   压缩对话历史，减少上下文占用                              │
│                                                             │
│ * /clear                                             内置    │
│   清除对话，开始新会话                                      │
│                                                             │
│ 项目技能                                                    │
│ * frontend-design                                   Codex   │
│   创建高质量前端界面                                        │
│                                                             │
│ * code-review-expert                                Claude  │
│   深度代码审查                                              │
└─────────────────────────────────────────────────────────────┘
```

### 面板能力

1. 顶部显示当前可用技能总数。
2. 支持 Tabs：
   - `Skills`
   - `Plugins`
   - 第一版 `Plugins` 可显示空状态，但保留结构。
3. 支持搜索：
   - 匹配 skill id、label、description。
   - 输入 `/front` 可过滤 `frontend-design`。
4. 支持分组：
   - 内置命令
   - Codex skills
   - Claude skills
   - 项目 skills
5. 支持标签：
   - `内置`
   - `Claude`
   - `Codex`
   - `Both`
   - `项目`
6. 支持键盘：
   - `↑/↓` 切换高亮项。
   - `Enter` 选择或取消选择。
   - `Esc` 关闭。
7. 支持多选：
   - 第一版每个 agent 最多选择 1 个 skill。
   - 数据模型按数组设计，后续可放开多选。

### 按模式显示

| mode | UI 行为 |
| --- | --- |
| `codexOnly` | 面板只展示 Codex 可用 skill 和通用 skill |
| `claudeOnly` | 面板只展示 Claude 可用 skill 和通用 skill |
| `collaborative` | 面板展示 Claude/Codex 分组，选择时记录到对应 agent |
| `custom` | 第一版不支持 skill，面板显示空状态或禁用 |

### 已选状态

composer controls 区域显示已选 skill chip：

```
Claude: code-review-expert   Codex: frontend-design
```

点击 chip 的 `x` 可以取消。

如果用户在协作模式中选择某个 `both` skill，弹出轻量选择：

- 用于 Claude
- 用于 Codex
- 两者都用

第一版也可以默认“两者都用”，但必须在 chip 中清楚展示。

## 数据模型

### 类型

```ts
export type SkillAgent = "claude" | "codex" | "both";

export type SkillSource = "builtin" | "codex-skill" | "claude-skill" | "project" | "plugin";

export interface AgentSkill {
  id: string;
  label: string;
  agent: SkillAgent;
  source: SkillSource;
  path: string | null;
  description: string | null;
  command: string | null;
  builtin: boolean;
}

export interface TaskSkillSelection {
  claude: string[];
  codex: string[];
}
```

非内置 skill 的 `id` 使用 `<source>:<directoryName>`，例如 `codex-skill:frontend-design`。`label` 保留目录名用于展示，避免 Claude、Codex、project skills 同名时解析到错误技能。

默认值：

```ts
export const EMPTY_SKILL_SELECTION: TaskSkillSelection = {
  claude: [],
  codex: [],
};
```

### 数据库

第一版使用 JSON 字段，避免过早引入关系表。

遵循项目已有的 `addColumnIfMissing` 迁移模式（见 `db.ts`），不使用原始 ALTER TABLE SQL：

```ts
// 在 db.ts migrate() 函数的 addColumnIfMissing 调用区域追加：
addColumnIfMissing(database, "tasks", "skillSelectionJson", "TEXT");
addColumnIfMissing(database, "tasks", "pendingSkillSelectionJson", "TEXT");
addColumnIfMissing(database, "task_messages", "skillSelectionJson", "TEXT");
```

字段含义：

- `tasks.skillSelectionJson`：当前任务默认 skill 选择。
- `tasks.pendingSkillSelectionJson`：运行中追加时，等待下一轮应用的 skill 选择。
- `task_messages.skillSelectionJson`：本次用户追加消息携带的 skill 选择。

兼容策略：

- 旧数据字段为 `NULL` 时按 `EMPTY_SKILL_SELECTION` 处理。
- JSON 解析失败时返回空选择，并记录 warn 日志，不让旧任务崩溃。

### 原子性应用：applyTaskModeAndSkills

`pendingMode` 和 `pendingSkillSelectionJson` 必须在同一 SQL UPDATE 中同步应用和清空，避免崩溃导致两者不一致（mode 已应用但 skill 未应用的竞态问题）。

新增函数（`db.ts`）：

```ts
export function applyTaskModeAndSkills(
  taskId: string,
  mode: TaskMode,
  skillSelectionJson: string | null,
) {
  getDb()
    .prepare(
      `UPDATE tasks SET
        pendingMode = NULL,
        mode = ?,
        pendingSkillSelectionJson = NULL,
        skillSelectionJson = ?,
        updatedAt = ?
      WHERE id = ?`,
    )
    .run(mode, skillSelectionJson, nowIso(), taskId);
}
```

与现有 `applyTaskMode` 的关系：

- `applyTaskMode` 仅处理 mode 切换，不涉及 skill（旧流程兼容）。
- `applyTaskModeAndSkills` 在 skill 功能启用后替代 `applyTaskMode`，确保原子性。
- scheduler 中 `continueAfterMessage` 对非运行任务的分支应改用 `applyTaskModeAndSkills`。

### 序列化与解析函数

新增（`db.ts` 或独立 `skills.ts`）：

```ts
export function serializeSkillSelection(selection: TaskSkillSelection): string | null {
  if (selection.claude.length === 0 && selection.codex.length === 0) return null;
  return JSON.stringify(selection);
}

export function parseSkillSelection(json: string | null): TaskSkillSelection {
  if (!json) return EMPTY_SKILL_SELECTION;
  try {
    const parsed = JSON.parse(json);
    if (
      typeof parsed === "object" &&
      Array.isArray(parsed.claude) &&
      Array.isArray(parsed.codex)
    ) {
      return { claude: parsed.claude, codex: parsed.codex };
    }
    console.warn("[MOSS] skillSelectionJson 格式异常，返回空选择", json);
    return EMPTY_SKILL_SELECTION;
  } catch {
    console.warn("[MOSS] skillSelectionJson 解析失败，返回空选择");
    return EMPTY_SKILL_SELECTION;
  }
}
```

## Zod Schema 扩展

现有 `createTaskSchema` 和 `createTaskMessageSchema` 使用 `.strict()` 模式，任何未定义的字段会被直接拒绝。必须显式扩展以允许 `skillSelection` 字段传入。

### createTaskSchema 扩展

```ts
// validation.ts — 扩展而非替换
export const skillSelectionSchema = z.object({
  claude: z.array(z.string()).max(1, "第一版每个 agent 最多选择 1 个 skill"),
  codex: z.array(z.string()).max(1, "第一版每个 agent 最多选择 1 个 skill"),
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
    // 新增 skillSelection（可选，默认空）
    skillSelection: skillSelectionSchema.optional(),
  })
  .strict();
```

### createTaskMessageSchema 扩展

```ts
export const createTaskMessageSchema = z.object({
  content: z.string().trim().min(1).max(12000),
  includeInContext: z.boolean().optional(),
  mode: z.enum(["collaborative", "codexOnly", "claudeOnly", "custom"]).optional(),
  // 新增 skillSelection（可选，追加消息时携带）
  skillSelection: skillSelectionSchema.optional(),
});
```

### 校验规则

`skillSelectionSchema` 仅校验结构和数量限制（第一版最多 1 个/agent）。具体 skill id 的存在性和 mode 兼容性校验由 `validateSkillSelection` 函数完成（见后文"校验与映射规则"章节），不在 zod 层处理，避免 zod schema 依赖动态 skill 列表。

## 类型变更

### CreateTaskInput

现有 `CreateTaskInput`（`types.ts`）缺少 `skillSelection` 字段。`db.createTask()` 直接从 `CreateTaskInput` 构造 Task 对象并 INSERT，如果类型上不存在该字段，SQL INSERT 不会包含新列，导致 skill 数据丢失。

```ts
// types.ts — 扩展 CreateTaskInput
export interface CreateTaskInput {
  projectId: string;
  parentTaskId?: string | null;
  prompt: string;
  mode: TaskMode;
  targetAgent?: AgentId | null;
  budget: BudgetLevel;
  permission: PermissionLevel;
  memoryMode?: MemoryMode;
  contextPolicy?: string;
  // 新增 skillSelection
  skillSelection?: TaskSkillSelection;
}
```

### Task 类型扩展

Task 对象从 DB 读取后需要携带 skillSelection 供前端和 scheduler 使用：

```ts
// types.ts — 扩展 Task
export interface Task {
  // ... 现有字段不变 ...
  // 新增
  skillSelectionJson: string | null;
  pendingSkillSelectionJson: string | null;
}
```

注意：`Task.skillSelectionJson` 存储 JSON 字符串（与 DB 一致），上层使用时通过 `parseSkillSelection(task.skillSelectionJson)` 转为 `TaskSkillSelection`。Task 类型上不直接存储 `TaskSkillSelection`，保持与 DB 字段的对齐。

### TaskMessage 类型扩展

```ts
// types.ts — 扩展 TaskMessage
export interface TaskMessage {
  // ... 现有字段不变 ...
  // 新增
  skillSelectionJson: string | null;
}
```

### TaskWithRelations 扩展

为了支持 `selectTask()` 同步 skill，`TaskWithRelations` 需要提供解析后的 skillSelection：

```ts
export interface TaskWithRelations extends Task {
  project: Project | null;
  stages: TaskStage[];
  logs: TaskLog[];
  messages: TaskMessage[];
  contextSnapshots: TaskContextSnapshot[];
  // 新增：解析后的 skill 选择
  skillSelection: TaskSkillSelection;
}
```

`getTaskWithRelations` 在组装时需调用 `parseSkillSelection(task.skillSelectionJson)` 填充此字段。

## Skill Registry

新增 `src/lib/server/skills.ts`。

### 职责

1. 扫描本机可用 skill。
2. 归一化成 `AgentSkill`。
3. 按 agent 和 mode 过滤。
4. 校验用户提交的 skill 是否存在且兼容。
5. 为 adapter 提供 skill 内容摘要。

### 校验与映射规则

#### validateSkillSelection

校验用户提交的 `skillSelection` 与 `mode` 的兼容性：

```ts
export function validateSkillSelection(
  selection: TaskSkillSelection,
  mode: TaskMode,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allSkills = listAvailableSkills(); // 懒加载缓存

  // 1. 存在性校验：每个 skill id 必须能在 registry 中找到
  for (const id of [...selection.claude, ...selection.codex]) {
    const found = findSkillById(allSkills, id);
    if (!found) {
      errors.push(`Skill "${id}" 不存在或不可用`);
    }
  }

  // 2. Mode 兼容性校验
  if (mode === "codexOnly") {
    for (const id of selection.claude) {
      errors.push(`Skill "${id}" 不能分配给 Claude：当前 codexOnly 模式不会运行 Claude 阶段`);
    }
  }

  if (mode === "claudeOnly") {
    for (const id of selection.codex) {
      errors.push(`Skill "${id}" 不能分配给 Codex：当前 claudeOnly 模式不会运行 Codex 阶段`);
    }
  }

  if (mode === "custom") {
    // custom 模式不支持任何 skill 选择
    if (selection.claude.length > 0 || selection.codex.length > 0) {
      errors.push("自定义 agent 模式不支持 skill 选择");
    }
  }

  for (const id of selection.claude) {
    const found = findSkillById(allSkills, id);
    if (found && found.agent === "codex") {
      errors.push(`Skill "${found.label}" 仅适用于 Codex，不能分配给 Claude`);
    }
  }

  for (const id of selection.codex) {
    const found = findSkillById(allSkills, id);
    if (found && found.agent === "claude") {
      errors.push(`Skill "${found.label}" 仅适用于 Claude，不能分配给 Codex`);
    }
  }

  // 3. 数量校验（第一版限制）
  if (selection.claude.length > 1) {
    errors.push("第一版每个 agent 最多选择 1 个 skill（Claude）");
  }
  if (selection.codex.length > 1) {
    errors.push("第一版每个 agent 最多选择 1 个 skill（Codex）");
  }

  return { ok: errors.length === 0, errors, warnings };
}
```

**关键策略**：Mode 不兼容的 skill 直接返回 error，避免请求成功但对应 agent 阶段实际不会注入。前端面板也按 mode 过滤可选项，减少无效选择。

#### resolveSkillAgentForMode

`both` 类型 skill 在不同 mode 下的归属映射规则：

```ts
export function resolveSkillAgentForMode(
  skill: AgentSkill,
  mode: TaskMode,
): "claude" | "codex" | "both" {
  if (skill.agent !== "both") return skill.agent;

  // both skill 在单 agent 模式下归入唯一活跃 agent
  if (mode === "codexOnly") return "codex";
  if (mode === "claudeOnly") return "claude";
  // collaborative 模式下保持 both，由用户选择或默认两者都用
  return "both";
}
```

UI 选择 `both` skill 时，根据 mode 自动应用映射：
- `codexOnly` → 直接写入 `TaskSkillSelection.codex` 数组，chip 只显示 `Codex: frontend-design`
- `claudeOnly` → 直接写入 `TaskSkillSelection.claude` 数组
- `collaborative` → 弹出三选一（用于 Claude / 用于 Codex / 两者都用），第一版可默认"两者都用"

#### both skill 的去重注入

当 `both` skill 写入两个数组（collaborative 模式"两者都用"），`resolveSkillsForStage` 只按当前 `stage.agent` 过滤注入，避免同一 skill 在 Claude 和 Codex 阶段各自注入一次导致 prompt 重复：

```ts
export function resolveSkillsForStage(
  selection: TaskSkillSelection,
  stageAgent: AgentId,
): AgentSkill[] {
  const agentKeys = stageAgent === "claude" ? ["claude"] : stageAgent === "codex" ? ["codex"] : [];
  const skillIds = agentKeys.flatMap((key) => selection[key] ?? []);
  return skillIds
    .map((id) => findSkillById(allSkills, id))
    .filter((s) => s !== undefined) as AgentSkill[];
}
```

### Skill 来源

第一版支持：

1. 内置命令
   - `/compact`
   - `/clear`
   - `/context`
   - `/add-dir`
   - 只用于 UI 展示和后续扩展，默认不进入 task skill selection。
   - **内置命令在面板中不可选择**：`builtin=true` 的 skill 在面板中灰色显示，点击后提示"内置命令不可选为任务技能"。只有 `builtin=false` 的 skill 才可选择并写入 `TaskSkillSelection`。

2. Codex skills
   - 扫描 `/Users/mondoi/.codex/skills/*/SKILL.md`。
   - agent 默认标记为 `codex`。
   - 若后续在 metadata 中声明 `agent: both`，再按声明处理。

3. Claude skills
   - 第一版预留结构。
   - 后续可接入 Claude Code plugin/native skill 目录。

4. Project skills
   - 第一版预留 `.moss-agent/skills/*/SKILL.md`。
   - 如项目目录不存在，返回空列表。

### API

新增：

```http
GET /api/skills?agent=claude|codex|all&mode=collaborative|codexOnly|claudeOnly|custom
```

响应：

```json
{
  "skills": [
    {
      "id": "frontend-design",
      "label": "frontend-design",
      "agent": "codex",
      "source": "codex-skill",
      "path": "/Users/mondoi/.codex/skills/frontend-design/SKILL.md",
      "description": "Create distinctive, production-grade frontend interfaces...",
      "command": "/frontend-design",
      "builtin": false
    }
  ],
  "counts": {
    "skills": 14,
    "plugins": 0
  }
}
```

约束：

- route 使用 `runtime = "nodejs"`。
- 文件系统扫描必须懒加载，不能在模块顶层初始化。
- 进程内短缓存，TTL = 30 秒。刷新按钮通过 `?refresh=1` 绕过缓存，清除缓存立即重新扫描文件系统。
- Skill 目录不存在时返回空列表（如 `~/.codex/skills/` 未创建），不报错。

### Skill 文件不存在时的运行时处理

用户在创建任务时选了某个 skill，但之后 skill 文件被删除（如清理 ~/.codex/skills/）。当 scheduler 到达对应 stage 尝试注入 skill 内容时：

- **策略**：skill 是辅助增强，不应成为任务执行的硬依赖。
- `resolveSkillsForStage` 在读取 SKILL.md 文件时，如果文件不存在：
  1. 记录 warn 日志：`Skill "{id}" 文件不存在（{path}），跳过注入`。
  2. 跳过该 skill 的注入，继续执行 stage（不终止 stage）。
  3. inputSummary 中标注：`技能 frontend-design（文件不存在，已跳过）`。
- API 层（`GET /api/skills`）返回的 skill 列表反映当前文件系统状态，如果 skill 已不存在则不再列出。但 `validateSkillSelection` 在创建/追加时校验的是**当时**的 skill 列表，如果创建后 skill 文件消失，属于运行时容错范畴。

## 创建任务与追加消息

### 创建任务

`POST /api/tasks` 请求体增加：

```json
{
  "projectId": "...",
  "prompt": "...",
  "mode": "codexOnly",
  "targetAgent": "codex",
  "budget": "standard",
  "permission": "workspaceWrite",
  "skillSelection": {
    "claude": [],
    "codex": ["frontend-design"]
  }
}
```

后端处理（`src/app/api/tasks/route.ts`）：

```ts
// route.ts POST handler 变更
export async function POST(request: Request) {
  try {
    const input = createTaskSchema.parse(await request.json());
    // 新增：校验 skillSelection 与 mode 兼容性
    if (input.skillSelection) {
      const validation = validateSkillSelection(input.skillSelection, input.mode);
      if (!validation.ok) {
        return jsonError({ message: validation.errors.join("; ") }, { status: 400 });
      }
    }
    // createTask 内部将 skillSelection 序列化写入 skillSelectionJson 列
    const task = createTask(input);
    getScheduler().enqueue(task.id);
    return jsonOk({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
```

`db.createTask()` 变更（`src/lib/server/db.ts`）：

- `CreateTaskInput` 已扩展 `skillSelection?: TaskSkillSelection`。
- INSERT 语句需新增 `skillSelectionJson` 列。
- Task 对象构造时新增 `skillSelectionJson: serializeSkillSelection(input.skillSelection ?? EMPTY_SKILL_SELECTION)`。
- `pendingSkillSelectionJson` 初始值为 `null`。

```ts
// db.ts createTask 变更要点（伪代码，展示关键新增部分）
const task: Task = {
  // ... 现有字段 ...
  skillSelectionJson: serializeSkillSelection(input.skillSelection ?? EMPTY_SKILL_SELECTION),
  pendingSkillSelectionJson: null,
};

// INSERT 语句新增 skillSelectionJson 和 pendingSkillSelectionJson
getDb().prepare(
  `INSERT INTO tasks (
    id, projectId, ..., skillSelectionJson, pendingSkillSelectionJson, ...
  ) VALUES (?, ?, ..., ?, ?, ...)`,
).run(task.id, task.projectId, ..., task.skillSelectionJson, task.pendingSkillSelectionJson, ...);
```

### 追加当前任务

`POST /api/tasks/[taskId]/messages` 请求体增加：

```json
{
  "content": "继续完善 UI",
  "includeInContext": true,
  "mode": "codexOnly",
  "skillSelection": {
    "claude": [],
    "codex": ["frontend-design"]
  }
}
```

后端处理（`src/app/api/tasks/[taskId]/messages/route.ts`）：

```ts
// route.ts POST handler 变更
export async function POST(request: Request, context: RouteContext) {
  try {
    const { taskId } = await context.params;
    const input = createTaskMessageSchema.parse(await request.json());
    // 新增：校验 skillSelection 与 mode 兼容性
    if (input.skillSelection) {
      const effectiveMode = input.mode || getTask(taskId)?.mode || "collaborative";
      const validation = validateSkillSelection(input.skillSelection, effectiveMode);
      if (!validation.ok) {
        return jsonError({ message: validation.errors.join("; ") }, { status: 400 });
      }
    }
    // createTaskMessage 内部保存 skillSelectionJson
    const message = createTaskMessage({
      taskId,
      role: "user",
      content: input.content,
      includeInContext: input.includeInContext,
      skillSelection: input.skillSelection ?? EMPTY_SKILL_SELECTION,
    });
    try {
      // 新增：传入 skillSelectionOverride
      getScheduler().continueAfterMessage(taskId, input.mode, input.skillSelection);
    } catch (notifyError) {
      console.warn("追加任务调度失败", notifyError);
    }
    const task = getTaskWithRelations(taskId);
    return jsonOk({ message, task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
```

`db.createTaskMessage()` 变更（`src/lib/server/db.ts`）：

- 函数签名新增 `skillSelection?: TaskSkillSelection` 参数。
- INSERT 语句新增 `skillSelectionJson` 列。
- 写入 `serializeSkillSelection(skillSelection ?? EMPTY_SKILL_SELECTION)`。

```ts
// db.ts createTaskMessage 变更要点
export function createTaskMessage(input: {
  taskId: string;
  role: TaskMessageRole;
  content: string;
  includeInContext?: boolean;
  skillSelection?: TaskSkillSelection;  // 新增
}): TaskMessage {
  // ... 现有逻辑 ...
  getDb().prepare(
    `INSERT INTO task_messages (
      id, taskId, role, content, includeInContext, skillSelectionJson, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id, message.taskId, message.role, message.content,
    message.includeInContext ? 1 : 0,
    serializeSkillSelection(input.skillSelection ?? EMPTY_SKILL_SELECTION),
    message.createdAt,
  );
  // ... 现有逻辑 ...
}
```

## Scheduler 变更

### continueAfterMessage

签名改为：

```ts
continueAfterMessage(
  taskId: string,
  modeOverride?: TaskMode,
  skillSelectionOverride?: TaskSkillSelection,
): void
```

应用规则：

1. 如果任务正在执行：
   - `modeOverride` 写入 `pendingMode`。
   - `skillSelectionOverride` 写入 `pendingSkillSelectionJson`。
   - 当前 attempt 不被打断。

2. 如果任务未执行：
   - 立即计算 effective mode 和 effective skill selection。
   - 更新 `tasks.mode`、`tasks.skillSelectionJson`。
   - 创建 continuation stage 并入队。

3. 进入下一轮执行前：

```ts
const effectiveSkillSelection =
  skillSelectionOverride
  ?? pendingSkillSelection
  ?? task.skillSelection
  ?? EMPTY_SKILL_SELECTION;
```

4. 应用 pending 后必须清空：
   - `pendingMode = null`
   - `pendingSkillSelectionJson = null`

### runContext

`AgentRunContext` 增加：

```ts
skills?: AgentSkill[];
```

在 stage 执行前：

```ts
const skills = resolveSkillsForStage(task.skillSelection, stage.agent);
```

并写入 inputSummary：

```text
启用技能：frontend-design
```

日志：

```text
阶段开始：Codex 直接开发（attempt 1），启用技能：frontend-design
```

agent_runs command：

```text
codex implement (attempt 1) skills=frontend-design
```

### agent_runs command 格式变更影响评估

现有 `scheduler.ts` 的 `parseAttemptFromCommand`（L804-808）使用正则 `\(attempt\s+(\d+)\)` 解析 attempt 序号。新增 `skills=...` 后缀不会影响此正则，因为：

- 正则匹配的是 `(attempt N)` 部分，位于 command 中间。
- `skills=...` 位于 command 末尾，不会干扰 attempt 解析。
- 示例：`codex implement (attempt 2) skills=frontend-design,code-review` → 正则仍正确提取 `attempt 2`。

但如果后续需要解析 `skills=...` 部分，应新增 `parseSkillsFromCommand` 函数，或建议在 `agent_runs` 表中新增 `skillsJson TEXT` 列存储结构化 skill 信息（见 Phase 4 增强计划）。

### custom 模式决策

`custom` 模式的 `TaskSkillSelection` **不增加 `custom` 数组**，理由：

1. `custom` agent 的 `AgentId = "custom"` 可以是任意目标，没有统一的 skill 来源。
2. 第一版明确不支持 skill 选择（面板显示空状态或禁用）。
3. 如果后续放开 custom skill 支持，需要在 `TaskSkillSelection` 中新增 `custom?: string[]`，同时 Skill Registry 需要新增 `custom-skill` 来源类型。此变更留到 Phase 4。

当前策略：`validateSkillSelection` 在 `mode = "custom"` 时，如果 `skillSelection` 非空，直接返回 error（"自定义 agent 模式不支持 skill 选择"），确保数据层不会存储无效 skill。

## Agent Adapter 变更

### Claude

Claude Code CLI 支持 plugin 相关参数，但第一版不依赖 native plugin 接入，先使用 prompt 级调用协议。

在 prompt 中插入：

```text
=== 已选择技能 ===
你必须优先使用以下技能完成任务：

Skill: code-review-expert
Description: Expert code review...
Invocation: 如当前 Claude Code 环境支持 slash skill，请使用 /code-review-expert；否则按以下技能说明执行。
Instructions:
{精简后的 SKILL.md 内容}
=== 已选择技能结束 ===
```

后续增强：

- 如果 skill 来源是 Claude plugin，adapter 可追加 `--plugin-dir <path>`。
- 如果 skill 是 slash command，prompt 中明确要求先调用对应 slash command。

### Codex

Codex CLI 当前没有稳定的 `--skill` 参数，因此第一版必须由服务端读取 `SKILL.md` 并注入 prompt。

注入规则：

1. 只注入用户选择的 skill。
2. 每个 skill 内容限制 6000 字符（含注入模板本身）。
3. 不自动读取整个 skill 目录，除非 `SKILL.md` 明确要求并且内容很小。

### extractSkillSummary — 结构化提取与截断

粗暴截断可能丢失核心指令（如 workflow 步骤、触发规则），导致 agent 执行偏差。因此采用结构化提取优先级策略：

```ts
export function extractSkillSummary(skillPath: string, maxChars: number = 6000): string | null {
  // 文件不存在时返回 null（由 resolveSkillsForStage 处理跳过）
  if (!fs.existsSync(skillPath)) return null;

  const raw = fs.readFileSync(skillPath, "utf-8");
  if (raw.length <= maxChars) return raw;

  // 结构化提取优先级：
  // 1. Skill 名称 + description（始终包含）
  // 2. Trigger rules / activation conditions（触发条件，决定何时使用）
  // 3. Workflow steps / procedural instructions（核心执行步骤）
  // 4. Scripts / commands / tool usage（工具调用方式）
  // 5. 其余内容按剩余字符填充（examples, notes, caveats）

  const sections = parseMarkdownSections(raw);
  const priority = ["description", "trigger", "triggers", "when to use", "workflow", "steps", "procedure", "scripts", "commands", "tools", "usage"];

  let result = "";
  // 1. 标题和描述（必须保留）
  const titleMatch = raw.match(/^#\s+.+/m);
  if (titleMatch) result += titleMatch[0] + "\n\n";

  // 2. 按优先级提取 sections
  for (const keyword of priority) {
    const section = sections.find((s) => s.heading.toLowerCase().includes(keyword));
    if (section && result.length + section.content.length <= maxChars) {
      result += section.content + "\n\n";
    }
  }

  // 3. 剩余字符填充未提取的 sections
  for (const section of sections) {
    if (!result.includes(section.content) && result.length + section.content.length <= maxChars) {
      result += section.content + "\n\n";
    }
  }

  // 4. 仍未填满但 raw 更长时，追加截断提示
  if (result.length < raw.length && result.length < maxChars - 100) {
    result += `\n[技能内容已精简，完整内容见 ${skillPath}]`;
  }

  return result.slice(0, maxChars);
}
```

辅助函数 `parseMarkdownSections`：按 `##` 标题切分 SKILL.md 为 section 数组，每个 section 包含 `{ heading, content }`。

## 前端组件拆分

避免 `workbench.tsx` 和 `Composer.tsx` 继续膨胀，建议新增：

```text
src/components/composer/
  Composer.tsx
  SkillTriggerButton.tsx
  SkillPalette.tsx
  SkillPaletteItem.tsx
  SelectedSkillChips.tsx
  skill-utils.ts
  types.ts
```

新增 hook：

```text
src/hooks/useSkills.ts
```

职责：

- 加载 `/api/skills`。
- 按 mode 过滤。
- 支持 refresh。
- 暴露 loading/error。

`ComposerProps` 增加：

```ts
skills: AgentSkill[];
skillSelection: TaskSkillSelection;
onSkillSelectionChange: (selection: TaskSkillSelection) => void;
onRefreshSkills: () => void;
skillsLoading: boolean;
```

`Workbench` 增加状态：

```ts
const [skillSelection, setSkillSelection] = useState<TaskSkillSelection>(EMPTY_SKILL_SELECTION);
```

创建任务和追加消息时传入 `skillSelection`。

`startNewTask()` 和 `selectProject()` 重置 skillSelection。

`selectTask()` 可选择是否同步任务当前 skill：

- 推荐同步：进入任务详情后，composer 默认展示该任务当前 skill。
- 用户修改后，下一次追加才生效。

## 样式方案

新增或扩展：

```text
src/app/styles/composer.css
```

样式要求：

1. 面板绝对定位在 composer 上方。
2. 最大高度不超过视口 55%，内部滚动。
3. 深色半透明背景，与当前 app 风格一致。
4. 高亮项、已选项、agent tag 必须清楚。
5. 移动端面板占据底部上方宽度，避免遮住发送按钮。

关键 class：

```css
.skillTrigger
.skillPalette
.skillPaletteHeader
.skillPaletteTabs
.skillPaletteSearch
.skillPaletteList
.skillPaletteGroup
.skillPaletteItem
.skillPaletteItemActive
.skillPaletteItemSelected
.skillTag
.selectedSkillChips
```

## 验收标准

### UI

1. 点击 composer 左侧技能按钮能打开技能面板。
2. 输入 `/` 能打开技能面板并进入搜索状态。
3. 面板显示总数、Tabs、分组、描述和 agent/source 标签。
4. 可以选择和取消 skill。
5. 已选择 skill 在 composer 中以 chip 展示。
6. 切换 mode 后，不兼容 skill 自动移除或提示确认移除。

### 创建任务

1. `codexOnly + frontend-design` 创建任务后，数据库保存 Codex skill。
2. Codex stage 的 `inputSummary` 和日志显示启用了 `frontend-design`。
3. Codex prompt 中包含 `frontend-design` 的技能说明。

### 协作任务

1. `collaborative` 下可以分别选择 Claude skill 和 Codex skill。
2. Claude plan/revise/audit 阶段只接收 Claude skill。
3. Codex review/implement 阶段只接收 Codex skill。

### 追加任务

1. 在任务详情页修改 skill 后发送补充说明，仍追加到同一个 task。
2. 新 skill 驱动后续 continuation stage。
3. 任务运行中追加时，skill 写入 pending，当前阶段不被打断。
4. 下一轮执行应用 pending skill，并清空 pending 字段。

### 兼容性

1. 未选择 skill 时，现有流程完全不变。
2. 旧任务 `skillSelectionJson = NULL` 不报错，按 `EMPTY_SKILL_SELECTION` 处理。
3. skill 文件不存在时，后端返回明确错误（API 层）。
4. skill 文件在运行时被删除，scheduler warn 日志 + 跳过注入，任务不崩溃。
5. 刷新页面后已选 skill 不丢失（从 DB `skillSelectionJson` 恢复）。
6. 超时重试后 skill 不丢失（pending 字段持久化到 DB）。
7. pendingMode 和 pendingSkillSelection 原子性应用（`applyTaskModeAndSkills` 单 UPDATE 语句）。

## 测试建议

### 单元测试

1. `parseSkillSelection` — NULL/空字符串/格式异常/正常 JSON
2. `serializeSkillSelection` — 空选择返回 null/正常序列化
3. `validateSkillSelection` — skill 不存在/codexOnly 下选 claude skill/custom 模式选 skill/正常兼容
4. `filterSkillsByMode` — 各 mode 下的过滤结果
5. `resolveSkillsForStage` — claude stage 只接收 claude skill/codex stage 只接收 codex skill/both skill 去重
6. `resolveSkillAgentForMode` — both skill 在各 mode 下的归属映射
7. `extractSkillSummary` — 文件不存在返回 null/内容≤6000 直接返回/内容>6000 结构化截断优先级
8. `applyTaskModeAndSkills` — 原子性验证（pendingMode + pendingSkillSelection 同时清空）

### API 测试

1. `GET /api/skills` — 返回 skill 列表和 counts
2. `GET /api/skills?refresh=1` — 绕过缓存重新扫描
3. `GET /api/skills?mode=codexOnly` — 只返回 codex + both skill
4. `POST /api/tasks` 带合法 skillSelection
5. `POST /api/tasks` 带不存在 skill id（返回 400）
6. `POST /api/tasks` 帡 custom mode + skillSelection（返回 400）
7. `POST /api/tasks` 不带 skillSelection（现有流程不受影响）
8. `POST /api/tasks/[taskId]/messages` 带合法 skillSelection
9. `POST /api/tasks/[taskId]/messages` 带不兼容 skill（返回 warning）

### 手动验证

1. 创建 Codex-only 任务并选择 `frontend-design`。
2. 创建 Claude-only 任务并选择 Claude skill。
3. 创建 collaborative 任务分别选择 Claude/Codex skill。
4. 创建 collaborative 任务选择 `both` skill，验证三选一弹窗或默认"两者都用"行为。
5. 创建 custom 任务，验证 skill 面板显示空状态/禁用。
6. 从 collaborative 切换到 codexOnly，验证 Claude skill chip 标灰 + 警告提示。
7. 对 completed task 追加新说明并修改 skill。
8. 对 running task 追加新说明并修改 skill，确认 pending 生效。
9. 选中已有任务后，验证 composer skill chip 同步到该任务的 skillSelection。
10. 验证 `/compact` 等内置命令在面板中不可选择。
11. 删除 skill 文件后验证任务执行不崩溃（warn 日志 + 跳过注入）。

验证命令：

```bash
pnpm lint
pnpm exec tsc --noEmit --incremental false
git diff --check
```

## 分阶段实施

### Phase 1：后端闭环

1. 增加类型。
2. 增加数据库字段和解析函数。
3. 增加 `skills.ts` registry。
4. 增加 `GET /api/skills`。
5. 创建任务和追加消息支持 skillSelection。

### Phase 2：调度与 adapter

1. scheduler 支持 pendingSkillSelection。
2. runContext 透传 skills。
3. Claude adapter 注入 skill 调用说明。
4. Codex adapter 注入 skill 摘要。
5. 日志、inputSummary、agent_runs 增加 skill 可见信息。

### Phase 3：composer 技能面板

1. 新增 `SkillPalette`。
2. 支持 `/` 触发、搜索、键盘选择。
3. 支持 mode 过滤和 selected chips。
4. 新建任务和追加消息传 skillSelection。

### Phase 4：体验增强

1. 支持 Claude native plugin。
2. 支持 project-local skills。
3. 支持多选与冲突检测。
4. 支持最近使用 skill。
5. 支持 pin 常用 skill。

## 风险与处理

| 风险 | 处理 |
| --- | --- |
| Codex 没有原生 skill 参数 | 服务端读取并注入 `SKILL.md` 摘要 |
| Claude native skill 来源不稳定 | 第一版走 prompt 协议，plugin-dir 作为后续增强 |
| skill 内容过长 | `extractSkillSummary` 结构化提取优先级 + 6000 字符上限 |
| 多 skill 冲突 | 第一版每 agent 最多选择 1 个 |
| 运行中修改 skill 打断当前任务 | 使用 pending 字段，下一轮应用 |
| UI 过复杂 | 面板浮层 + chip，不增加底部分叉按钮 |
| Mode 切换后 skill 不兼容 | 保留数据 + UI chip 标灰警告，不静默丢弃 |
| both skill 在单 agent 模式归属不清 | `resolveSkillAgentForMode` 明确映射规则 |
| pendingMode 与 pendingSkillSelection 竞态 | `applyTaskModeAndSkills` 原子 UPDATE |
| Skill 文件运行时消失 | `resolveSkillsForStage` warn 日志 + 跳过注入 |
| createTaskSchema `.strict()` 拒绝新字段 | 显式扩展 schema 增加 `skillSelection` |
| 内置命令被误选为 task skill | `builtin=true` 的 skill 在面板中不可选择（灰色 + 提示） |
| custom 模式 skill 无归属 | 第一版明确不支持，validate 返回 error |

## 文件变更清单

预计新增：

```text
docs/composer-skill-selection-development.md
src/lib/server/skills.ts              — Skill Registry、validateSkillSelection、resolveSkillsForStage、extractSkillSummary、resolveSkillAgentForMode
src/app/api/skills/route.ts           — GET /api/skills API
src/components/composer/SkillTriggerButton.tsx
src/components/composer/SkillPalette.tsx
src/components/composer/SkillPaletteItem.tsx
src/components/composer/SelectedSkillChips.tsx
src/components/composer/skill-utils.ts  — 前端 skill 过滤/映射工具
src/components/composer/types.ts        — 前端 skill 相关类型（复用 TaskSkillSelection 等）
src/hooks/useSkills.ts                  — skill 数据 hook（加载/过滤/刷新）
```

预计修改（含具体变更内容）：

| 文件 | 变更内容 |
| --- | --- |
| `src/lib/types.ts` | 新增 `SkillAgent`、`SkillSource`、`AgentSkill`、`TaskSkillSelection`、`EMPTY_SKILL_SELECTION` 类型；`Task` 增加 `skillSelectionJson`、`pendingSkillSelectionJson` 字段；`TaskMessage` 增加 `skillSelectionJson` 字段；`TaskWithRelations` 增加 `skillSelection` 字段；`CreateTaskInput` 增加 `skillSelection?: TaskSkillSelection` |
| `src/lib/server/db.ts` | migrate() 新增 3 个 `addColumnIfMissing` 调用（tasks.skillSelectionJson、tasks.pendingSkillSelectionJson、task_messages.skillSelectionJson）；新增 `applyTaskModeAndSkills()` 原子函数；新增 `serializeSkillSelection()`、`parseSkillSelection()`；`createTask()` INSERT 增加 skillSelectionJson + pendingSkillSelectionJson 列；`createTaskMessage()` INSERT 增加 skillSelectionJson 列；`getTaskWithRelations()` 组装 skillSelection 字段 |
| `src/lib/server/validation.ts` | 新增 `skillSelectionSchema`；`createTaskSchema` 增加 `skillSelection` 字段（保持 `.strict()`）；`createTaskMessageSchema` 增加 `skillSelection` 字段 |
| `src/lib/server/scheduler.ts` | `continueAfterMessage` 签名增加 `skillSelectionOverride?: TaskSkillSelection`；运行中任务写入 `pendingSkillSelectionJson`；非运行任务用 `applyTaskModeAndSkills` 原子应用；`runStageAttempt` 中 `runContext` 增加 `skills` 字段注入；`inputSummary` 构造增加 skill 信息行；`agent_runs.command` 增加 `skills=...` 后缀；日志增加 skill 可见信息 |
| `src/lib/agents/types.ts` | `AgentRunContext` 增加 `skills?: AgentSkill[]` 字段 |
| `src/lib/agents/claude.ts` | `buildPrompt()` 从 `runContext.skills` 读取 skill 列表，在 prompt 中插入 skill 调用说明块（名称 + description + invocation + 精简 SKILL.md 内容） |
| `src/lib/agents/codex.ts` | `buildRunPrompt()` 和 `buildReviewPrompt()` 从 `runContext.skills` 读取 skill 列表，注入 `extractSkillSummary()` 提取的结构化摘要 |
| `src/app/api/tasks/route.ts` | POST handler 校验 `skillSelection` 后调用 `createTask(input)`（input 含 skillSelection） |
| `src/app/api/tasks/[taskId]/messages/route.ts` | POST handler 校验 `skillSelection`，`createTaskMessage` 增加 skillSelection 参数，`continueAfterMessage` 增加第三参数 `input.skillSelection` |
| `src/components/workbench.tsx` | 新增 `skillSelection` state（`useState<TaskSkillSelection>(EMPTY_SKILL_SELECTION)`）；`startNewTask`/`selectProject` 重置 skillSelection；`selectTask` 从 `taskDetails.skillSelection` 同步；`createTask`/`appendTaskMessage` 请求体传入 skillSelection；Composer 增加 skill 相关 props |
| `src/components/composer/Composer.tsx` | ComposerProps 增加 `skills`、`skillSelection`、`onSkillSelectionChange`、`onRefreshSkills`、`skillsLoading`；渲染 SkillTriggerButton + SkillPalette + SelectedSkillChips |
| `src/app/styles/composer.css` | 新增 skill 相关样式 class（.skillTrigger、.skillPalette、.skillPaletteItem、.skillPaletteItemSelected、.skillTag、.selectedSkillChips 等） |
