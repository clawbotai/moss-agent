# Agent 确认交互功能

## 概述

当 Claude 或 Codex 在执行任务时遇到需要用户确认的需求边界问题（例如：需求不明确、存在多种实现方式需要选择、边界条件需要澄清等），系统会自动检测并暂停任务，等待用户确认后再继续执行。

## 实现细节

### 1. 确认请求检测方式

系统支持两种检测方式：

#### 方式 1：显式格式（推荐）

Agent 可以在输出中使用以下格式请求用户确认：

```
[CONFIRM] 你的问题描述
[OPTIONS] 选项1 | 选项2 | 选项3
[DEFAULT] 0
```

- `[CONFIRM]`：必需，确认问题的描述
- `[OPTIONS]`：可选，如果有多选方案，用 `|` 分隔
- `[DEFAULT]`：可选，默认选项的索引（从 0 开始）

#### 方式 2：智能检测

系统会自动检测 agent 输出中的问题模式，支持多种格式：

**Q1/Q2/Q3 格式：**
```
**Q1：你说的「skill 调用」具体指哪种场景？**
- **A)** 在任务流程中调用 Claude Code 已有的 Skill 工具
- **B)** 在 moss-agent 平台内构建自有的 skill 注册/调度系统
- **C)** 两者都要 — 先集成已有能力，再设计可扩展框架
```

**编号问题格式：**
```
**1. 你的核心场景是什么？**
- **A)** 用户在 Composer 输入触发特定能力
- **B)** Agent 在执行过程中自动发现并调用合适的 skill
- **C)** 任务流程中某个阶段固定调用特定 skill

请回答上面的问题，我再给出详细的实施计划。
```

### 2. 任务状态流转

当 agent 输出包含确认请求时：

1. 任务状态变为 `waiting`
2. 确认请求信息保存在 `errorMessage` 字段（JSON 格式）
3. 任务暂停执行，等待用户回复

用户确认后：

1. 任务状态恢复为 `running`
2. 用户的确认回复保存到日志和当前任务消息，并标记为进入上下文
3. 调度器在下一次 agent 执行的恢复上下文中注入该确认回复
4. 任务从暂停处继续执行

### 3. API 端点

#### POST `/api/tasks/[taskId]/confirm`

处理用户确认回复。

**请求体：**
```json
{
  "response": "用户的确认回复"
}
```

**响应：**
```json
{
  "ok": true
}
```

### 4. UI 组件

#### ConfirmationDialog

确认对话框组件，支持两种输入方式：

- **选项选择**：当 agent 提供了 `[OPTIONS]` 时，显示单选按钮列表
- **自由文本输入**：当没有选项时，显示文本输入框

## 使用示例

### 示例 1：带选项的确认请求

Agent 输出：
```
我发现了两种实现方式：

[CONFIRM] 请选择实现方式
[OPTIONS] 使用 React Context 管理状态 | 使用 Redux 管理状态 | 使用 Zustand 管理状态
[DEFAULT] 0
```

UI 会显示一个包含三个选项的单选列表。

### 示例 2：自由文本确认请求

Agent 输出：
```
需求描述不够明确。

[CONFIRM] 请详细说明"用户权限"的具体含义：是指功能权限还是数据权限？
```

UI 会显示一个文本输入框让用户自由输入。

## 技术实现

### 文件变更

1. **`src/lib/agents/types.ts`**：扩展 `AgentRunResult` 类型，添加 `confirmationRequest` 字段
2. **`src/lib/agents/confirmation.ts`**：新增确认请求检测和解析功能
3. **`src/lib/agents/claude.ts`**：集成确认请求检测
4. **`src/lib/agents/codex.ts`**：集成确认请求检测
5. **`src/lib/server/scheduler.ts`**：支持暂停任务等待确认
6. **`src/app/api/tasks/[taskId]/confirm/route.ts`**：新增确认 API 端点
7. **`src/components/task/ConfirmationDialog.tsx`**：确认对话框 UI 组件
8. **`src/components/task/TaskDetail.tsx`**：集成确认对话框
9. **`src/hooks/useTaskConfirmation.ts`**：确认逻辑 hook
10. **`src/app/styles/timeline.css`**：确认对话框样式

## 注意事项

1. 推荐使用 `[CONFIRM]`、`[OPTIONS]`、`[DEFAULT]` 显式格式；系统也会尝试识别常见的编号问题和 Q1/Q2 选项格式
2. 确认请求会中断当前 stage 的执行，用户确认后会重新入队执行
3. 如果用户取消任务，任务状态会变为 `cancelled`
4. 确认请求信息保存在任务的 `errorMessage` 字段中，以 JSON 格式存储
5. 服务重启后，`waiting` 状态任务会保持暂停，不会绕过用户确认自动恢复执行
