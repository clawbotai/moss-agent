# Moss Agent 协作调度方案 v0.3

## 1. 结论

这份方案和当前项目方向匹配：项目已经具备 Next.js 应用路由、SQLite、本地 agent 适配器、任务阶段流转、项目级队列、服务端事件流、任务消息、上下文快照和暗色工作台。

需要调整的是边界表达：当前系统不是“每个任务默认创建独立工作区”的运行时，也还没有独立的 Artifact、AgentMessage、命令白名单、文件锁和自动修复循环。它更准确的定位应该是：

**本地 AI 开发任务调度台：以任务为隔离单元，用结构化上下文包协调 Claude Code、Codex 和后续自定义 agent。**

第一阶段应该继续强化“任务隔离、可追踪、可恢复、可审查”，不要过早引入复杂的多 agent 并发和向量记忆。

## 2. 当前项目匹配度

| 方案能力 | 当前状态 | 建议 |
| --- | --- | --- |
| Next.js + TypeScript + SQLite | 已匹配 | 保持 Node.js runtime，避免边缘运行时 |
| 暗色工作台 UI | 已匹配 | 继续以主视图折叠面板承载阶段、日志、审查和摘要 |
| 项目注册与任务列表 | 已匹配 | 后续增加最近项目、路径校验提示和项目归档 |
| 协作模式 | 已匹配 | 当前阶段顺序合理，可继续保留 |
| Codex 直接模式、Claude 直接模式 | 已匹配 | 作为明确入口保留 |
| 同项目串行、不同项目并行 | 已匹配 | 当前调度器按 projectId 排队，方向正确 |
| SSE 实时日志 | 已匹配 | 后续补心跳重连和日志游标 |
| 任务消息与日志分离 | 已匹配 | 当前 `task_messages` 是正确方向 |
| 上下文快照 | 已匹配 | 当前 `task_context_snapshots` 可用于 token 审计 |
| 任务级上下文隔离 | 基本匹配 | 默认不携带完整聊天和日志，应继续强化 |
| Artifact 管理 | 未实现 | 建议下一阶段新增 artifacts 表 |
| Agent 间结构化 handoff | 部分实现 | 目前靠阶段摘要传递，建议抽象 handoff 记录 |
| 自动修复循环 | 未实现 | 放到 v0.4，先做人工可控重试 |
| 命令白名单和文件锁 | 未实现 | 放到 Harness 阶段，不要阻塞 MVP |
| 独立 git worktree | 未实现 | 作为高风险任务的可选隔离策略 |

## 3. 核心原则

### 3.1 任务优先，不是聊天优先

系统应该记住任务，而不是无限聊天历史。

每个任务都是独立执行线程，默认只携带：

- 用户原始需求
- 当前任务摘要
- 阶段摘要
- 审查结论
- 交付摘要
- 用户显式选择进入上下文的消息

默认不携带：

- 完整聊天记录
- 完整日志
- 完整 stdout
- 其他任务的完整上下文

### 3.2 显式创建任务

底部输入区必须是上下文感知的 Task Command Bar：

- 空状态：创建新任务。
- 任务详情页：默认追加当前任务消息。
- “新开任务”：创建完全独立任务。
- “基于此任务继续”：创建派生任务，只继承摘要、审查结论、失败原因和用户显式选择的上下文块。

这和当前实现匹配，应该继续作为产品规则写入 README 和 UI 文案。

### 3.3 结构化交接，不靠自由聊天

Claude Code 和 Codex 不应该把完整输出互相塞回 prompt。每个阶段只接收：

- 上下文包
- 上一阶段摘要
- 必要 artifact 引用
- 当前阶段目标

长期看，agent 之间的通信应收敛成结构化 handoff，而不是自然语言流水账。

## 4. 当前数据模型对齐

当前代码中的核心模型已经足够支撑 MVP：

```typescript
type Project = {
  id: string
  name: string
  path: string
  createdAt: string
  updatedAt: string
}

type Task = {
  id: string
  projectId: string
  parentTaskId: string | null
  title: string
  prompt: string
  mode: "collaborative" | "codexOnly" | "claudeOnly" | "custom"
  targetAgent: "claude" | "codex" | "custom" | null
  budget: "low" | "standard" | "high"
  permission: "readOnly" | "workspaceWrite" | "fullAccess"
  memoryMode: "off" | "taskSummary" | "projectMemory"
  contextPolicy: string
  status: "queued" | "running" | "waiting" | "stuck" | "failed" | "cancelled" | "completed"
  currentStage: string | null
  summary: string | null
  errorMessage: string | null
}

type TaskStage = {
  id: string
  taskId: string
  name: string
  agent: "claude" | "codex" | "custom"
  role: "plan" | "review" | "revise" | "implement" | "audit" | "summarize"
  status: "queued" | "running" | "skipped" | "failed" | "cancelled" | "completed"
  inputSummary: string | null
  outputSummary: string | null
}
```

新增的两张表方向正确：

- `task_messages`：保存任务内补充说明，不等同于 agent prompt。
- `task_context_snapshots`：保存每次启动 agent 前的上下文包，用于审计 token 和复盘。

## 5. 建议新增模型

### 5.1 artifacts

当前阶段摘要可以先满足 MVP，但后续必须把产物独立出来。建议新增：

```typescript
type Artifact = {
  id: string
  taskId: string
  stageId: string | null
  type: "plan" | "review" | "diff" | "test" | "summary" | "handoff" | "report"
  title: string
  content: string
  filePath: string | null
  metadataJson: string | null
  createdAt: string
}
```

用途：

- 计划文档不再只塞进 stage output。
- 审查意见可单独渲染。
- diff、测试报告、交付报告可以下载或复制。
- 后续导出任务包时有稳定来源。

### 5.2 agent_messages

当前 `task_messages` 更像用户和任务的讨论记录。agent 之间的协作建议单独建模：

```typescript
type AgentMessage = {
  id: string
  taskId: string
  stageId: string | null
  fromAgent: "claude" | "codex" | "custom" | "system"
  toAgent: "claude" | "codex" | "custom" | "system" | "user"
  intent: "clarification" | "review_comment" | "blocked" | "status_update" | "fix_request"
  content: string
  artifactId: string | null
  createdAt: string
}
```

原则：

- 用户补充说明进 `task_messages`。
- agent 交接、阻塞、审查意见进 `agent_messages`。
- 可长期保留，但进入 prompt 前仍必须压缩成摘要。

### 5.3 agent_runs

建议记录每次 CLI 调用：

```typescript
type AgentRun = {
  id: string
  taskId: string
  stageId: string
  agent: "claude" | "codex" | "custom"
  command: string
  startedAt: string
  completedAt: string | null
  exitCode: number | null
  tokenEstimate: number | null
  errorMessage: string | null
}
```

用途：

- 排查 CLI 失败。
- 统计预算。
- 支撑“重试当前阶段”。
- 把日志和某次 agent 调用稳定关联起来。

## 6. 工作流设计

### 6.1 协作模式

当前默认阶段顺序合理：

1. Claude Code 生成计划。
2. Codex 审查计划。
3. Claude Code 修订计划。
4. Codex 执行开发。
5. Claude Code 审核结果。
6. 调度器汇总交付。

建议补充两个规则：

- 每个阶段完成后生成短摘要和可选 artifact。
- 下个阶段只接收“上下文包 + 上一阶段摘要 + 必要 artifact 引用”。

### 6.2 直接模式

直接模式应该继续保留：

- Codex 直接开发：适合明确实现任务。
- Claude Code 直接开发：适合复用 Claude Code 本地配置、MCP 和子 agent。
- 自定义 agent：先保留适配器入口，后续再做 UI 配置。

### 6.3 修复循环

自动修复循环建议不要放进当前 MVP 的默认行为。更稳妥的策略：

1. 审查失败时任务进入 `failed` 或 `waiting`。
2. UI 显示审查意见和建议动作。
3. 用户选择“重试当前阶段”“基于此任务继续”或“切换 agent”。
4. v0.4 再增加有上限的自动 fix loop。

原因：当前 CLI 运行权限较高，自动循环容易造成 token、文件改动和上下文膨胀失控。

## 7. 上下文引擎

当前 `buildContextPackage` 的方向正确，建议把策略固定成三层。

### 7.1 默认 taskSummary

默认策略：

- 带原始需求。
- 带当前任务摘要。
- 带阶段摘要。
- 带审查结论。
- 带交付摘要。
- 不带完整消息和完整日志。

### 7.2 显式 selectedMessages

用户勾选“本条消息进入后续上下文”后，消息才进入上下文包。

这点当前实现已经匹配，应该保持。

### 7.3 projectMemory

项目记忆不应该直接保存流水日志。建议只保存：

- 架构约定。
- 长期偏好。
- 关键技术决策。
- 常用验证命令。
- 重要风险和踩坑结论。

项目记忆应有确认入口，不应自动无限追加。

### 7.4 项目记忆：日志结构升级决策

当前交互阶段先用前端派生分类处理日志阅读体验，不立即升级数据库结构：

- 从现有 `logs.level`、`logs.message`、`logs.stageId` 派生 `event`、`agent-output`、`warning`、`error` 等 UI 分类。
- 主视图默认展示关键事件，原始 stdout/stderr 继续落在 `logs`，不进入上下文包。
- 等任务详情交互稳定后，再升级数据库日志结构，建议为 `logs` 增加 `kind`、`stream`、`agentRunId`、`sequence`、`isKeyEvent` 等字段。
- 该升级属于项目长期记忆和架构决策，不应在当前 UI 验证完成前提前引入迁移成本。

## 8. UI 设计对齐

主界面继续保持“天枢”式工作台，但业务结构按 Moss Agent 重做：

- 左侧：项目切换、任务搜索、任务列表、状态筛选。
- 顶部：当前项目、新开任务、agent 健康状态、全局运行状态。
- 中间：任务主视图。
- 底部：Task Command Bar。

任务主视图的折叠区建议固定为：

1. 阶段时间线：默认承载当前执行状态和每个阶段的关键输出。
2. 当前任务消息：保存任务内补充说明，不等同于新任务。
3. 审查意见：从 review / audit 阶段提取。
4. 交付摘要：任务完成后的结果入口。
5. 上下文包 / 记忆：展示 agent 实际会收到的压缩上下文。
6. 实时日志：默认只看关键事件，可切换当前阶段、警告错误和全部日志。
7. Artifacts。

当前项目已经实现前六项，Artifacts 是下一步。

## 9. 卡住与异常体验

当前调度器有 `stuck` 状态和继续等待、取消、重试、切换 agent 的 UI，方向正确。

建议优化点：

- 卡住检测应从“阶段运行时间过长”升级为“长时间无新输出”。
- 每次 `onLog` 输出后刷新无输出计时器。
- 卡住不应自动失败，只进入可操作状态。
- UI 展示最近一条日志、运行时长、当前 stage、可选动作。

建议状态：

```typescript
type BlockedReason =
  | "no_output_timeout"
  | "agent_exit_failed"
  | "budget_exceeded"
  | "project_path_invalid"
  | "requires_user_input"
```

## 10. Harness 与权限控制

Harness 是必要方向，但不建议阻塞当前 MVP。建议分阶段做：

### 10.1 当前阶段

- 保留 `permission` 字段。
- 在 prompt 中表达权限策略。
- 记录 agent command、exitCode、日志和错误。
- UI 明确显示权限档位。

### 10.2 下一阶段

- 增加命令审计。
- 增加危险命令提示。
- 增加单阶段 timeout。
- 增加预算上限。

### 10.3 复杂任务阶段

- 可选 git worktree 隔离。
- 文件锁。
- 命令白名单。
- 任务产物导出。

## 11. API 设计

当前 API 与新开任务设计匹配：

- `POST /api/tasks`：显式创建新任务。
- `POST /api/tasks/:taskId/messages`：当前任务追加消息。
- `POST /api/tasks/:taskId/continue`：继续等待或创建派生任务。
- `POST /api/tasks/:taskId/switch-agent`：切换 agent 并创建派生任务。
- `GET /api/tasks/:taskId/events`：SSE 实时事件。

建议新增：

- `GET /api/tasks/:taskId/artifacts`
- `POST /api/tasks/:taskId/export`
- `POST /api/tasks/:taskId/stages/:stageId/retry`
- `GET /api/tasks/:taskId/runs`
- `POST /api/projects/:projectId/memory`

## 12. MVP 边界

当前 MVP 应该聚焦：

- 多项目注册。
- 同项目串行、不同项目并行。
- 新任务、任务消息、派生任务分离。
- Claude + Codex 协作模式。
- Codex 直接模式。
- Claude 直接模式。
- 阶段、日志、审查意见、上下文包、交付摘要可折叠查看。
- agent 环境诊断。
- 卡住提示和人工操作。

暂不做：

- 自动部署。
- 自动 PR 合并。
- 多人协作。
- 向量记忆系统。
- 默认 worktree 隔离。
- 无上限自动修复循环。

## 13. 推荐实施顺序

### P0：巩固当前能力

1. 保持任务输入默认追加消息，不自动创建任务。
2. 保持派生任务只继承摘要和显式选择的上下文。
3. 补齐类型检查和构建问题。
4. 将上下文包生成规则写入 README。

### P1：补 Artifact 与 agent run 审计

1. 新增 `artifacts` 表。
2. 新增 `agent_runs` 表。
3. 每个阶段写入标准 artifact。
4. UI 增加 Artifacts 折叠区。

### P2：优化卡住检测与阶段重试

1. 无输出 watchdog。
2. 重试当前阶段。
3. 失败原因分类。
4. 日志游标和 SSE 重连。

### P3：结构化 handoff 与受控修复循环

1. 新增 `agent_messages`。
2. 将计划、审查、修复请求标准化。
3. 增加最多 1 到 3 次的可配置修复循环。
4. 达到上限后要求人工介入。

### P4：Harness

1. 命令审计。
2. 危险命令提示。
3. 可选 worktree。
4. 文件锁。
5. 任务产物导出。

## 14. 最终判断

你的建议是正确的，尤其是这几个点应该成为项目主线：

- 任务中心，而不是聊天中心。
- agent 协作必须结构化交接。
- 日志、消息、上下文和产物必须分开存。
- 默认强隔离，记忆显式开启。
- UI 直接在主视图折叠展示阶段、日志、审查和交付摘要。

需要收敛的是实施节奏：先把当前本地调度台做稳，再逐步引入 Artifact、AgentMessage、agent run 审计、阶段重试和 Harness。这样可以避免一开始把系统做成过重的“自治软件工厂”，同时保留后续扩展到任意 agent 的接口。
