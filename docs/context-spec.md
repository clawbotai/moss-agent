# 上下文包（Context Package）规范

> 本规范定义了 MOSS-Agent 系统中任务上下文包的生成规则、结构组成和行为约束。
> 与 `think.md` §3、§7 保持一致，是系统上下文引擎的设计蓝图。

## 1. 核心原则

### 1.1 三层策略（think.md §7）

| 策略 | 包含内容 | 适用场景 |
|------|----------|----------|
| **taskSummary** | 用户原始需求 + 当前任务摘要 + 阶段摘要 + 审查结论 + 交付摘要 | 默认 |
| **selectedMessages** | + 用户显式勾选进入上下文的消息 | 需用户主动操作 |
| **projectMemory** | + 已确认的项目记忆（架构/决策/规范/问题） | 开启记忆的项目 |

### 1.2 隔离规则

- 默认**不携带**：完整聊天记录、完整日志、完整 stdout、其他任务完整上下文
- 只传递：任务摘要、阶段摘要、审查结论、交付摘要、显式选择的消息
- Agent 间传递通过结构化 handoff，不靠自由聊天

### 1.3 截断规则

- 总上限 **12000 characters**
- 各 section 按阶段权重分配配额
- 超出时按权重比例截断，末尾标记 `...[已截断，避免上下文过长]`
- 截断后仍保持 section 完整性（不截断 mid-line）

---

## 2. 上下文包结构

每个阶段启动时，生成以下结构的上下文包：

```
# 任务上下文包

## 隔离策略
- 任务 ID
- 父任务 ID（如有）
- 记忆模式
- 上下文策略
- 当前上下文说明

## 用户原始需求
{trim(task.prompt)}

## 父任务上下文（如有派生任务）
- 父任务标题
- 上下文范围
- 父任务交付摘要
- 继承的阶段摘要
- 继承的消息（如有）

## 阶段摘要
1. {stage.name}（{stage.agent}/{stage.role}）：{outputSummary}
2. ...

## 审查结论
1. {review.name}：{outputSummary}
2. ...

## 交付摘要
{trim(task.summary)}

## 当前任务消息（如有选择的消息）
1. {role}：{content}
2. ...

## 项目记忆（memoryMode=projectMemory 时）
### [architecture] (来自任务 xxx)
{content}

### [decision] (手动)
{content}

## 变更范围（implement/audit 阶段）
### 统计
{summary}

### 变更文件
- file1.ts
- file2.ts
...

## 本次补充指令（如有）
{trim(extraInstruction)}
```

---

## 3. 各阶段上下文权重

### 3.1 默认权重配置

| Section | plan | review | revise | implement | audit | summarize |
|---------|------|--------|--------|-----------|-------|-----------|
| **用户原始需求** | 40% | 15% | 15% | 20% | 15% | 20% |
| **阶段摘要** | 0% | 25% | 25% | 20% | 20% | 40% |
| **审查结论** | 0% | 30% | 30% | 0% | 0% | 0% |
| **变更范围** | 0% | 0% | 0% | 15% | 25% | 0% |
| **项目记忆** | 20% | 10% | 10% | 15% | 15% | 10% |
| **父任务上下文** | 20% | 0% | 0% | 10% | 10% | 0% |
| **交付摘要** | 10% | 10% | 10% | 15% | 10% | 20% |
| **当前任务消息** | 10% | 10% | 10% | 5% | 5% | 10% |

### 3.2 权重配置示例

```json
// .moss-agent/config.json
{
  "contextWeights": {
    "plan": {
      "prompt": 0.4,
      "stages": 0.0,
      "memory": 0.2,
      "messages": 0.1,
      "parentContext": 0.2,
      "summary": 0.1
    },
    "review": {
      "prompt": 0.15,
      "stages": 0.25,
      "memory": 0.1,
      "messages": 0.1,
      "parentContext": 0.0,
      "summary": 0.1,
      "review": 0.3
    },
    "implement": {
      "prompt": 0.2,
      "stages": 0.2,
      "memory": 0.15,
      "messages": 0.05,
      "parentContext": 0.1,
      "summary": 0.15,
      "changes": 0.15
    },
    "audit": {
      "prompt": 0.15,
      "stages": 0.2,
      "memory": 0.15,
      "messages": 0.05,
      "parentContext": 0.1,
      "summary": 0.1,
      "changes": 0.25
    }
  }
}
```

### 3.3 权重调优

每个阶段完成后，记录 `task_context_snapshots.tokenEstimate`，用于分析：
- 哪些阶段经常被截断 → 增加对应 section 权重
- 哪些阶段 token 大量剩余 → 降低权重或增加其他 section

---

## 4. 各 Section 详细说明

### 4.1 隔离策略

```
## 隔离策略
任务 ID：{task.id}
父任务 ID：{task.parentTaskId || "无"}
记忆模式：{task.memoryMode}
上下文策略：{task.contextPolicy}
默认不携带完整聊天、完整日志或完整 stdout；只传递任务摘要、阶段摘要、审查结论和显式选择的消息。
```

### 4.2 用户原始需求

直接使用 `task.prompt`，截断到配额上限。

### 4.3 父任务上下文

派生任务时，根据 `DeriveOptions` 控制继承范围：

| 选项 | 说明 |
|------|------|
| `inheritStages` | `completed`（默认）只继承已完成的阶段摘要 |
| `inheritMessages` | `false`（默认）不继承对话历史 |
| `contextScope` | `standard`（默认）标准上下文范围 |
| `includeParentSummary` | `true`（默认）包含父任务交付摘要 |

### 4.4 阶段摘要

遍历已完成阶段的 `outputSummary`，格式：
```
1. {stage.name}（{stage.agent}/{stage.role}）：{outputSummary}
```

截断策略：每个阶段输出截断到 `MAX_SECTION_CHARS (2400)`。

### 4.5 审查结论

只提取 `role` 为 `review` 或 `audit` 的阶段输出。

### 4.6 交付摘要

直接使用 `task.summary`，截断到配额上限。

### 4.7 当前任务消息

只包含用户勾选 `includeInContext: true` 的消息。

### 4.8 项目记忆

- 检索策略：`projectMemory` 表中 `status = 'confirmed'` 的记录
- 检索条件：按 `taskPrompt` 关键词匹配，`category` 在 architecture/decision/convention/issue 中
- 数量限制：最多 5 条
- 格式：
  ```
  ### [{category}] (来自任务 {taskId})
  {content}
  ```

### 4.9 变更范围

仅 `implement` 和 `audit` 阶段生成：
- 统计：`{files.length} 个文件变更 (+{insertions} -{deletions})`
- 文件列表：前 20 个变更文件
- 来源：`git diff --stat --numstat`

### 4.10 本次补充指令

用户通过 `extraInstruction` 参数传入，不截断（已在上层保证合理长度）。

---

## 5. Token 估算

使用简化的 token 估算公式：

```typescript
function estimateTokens(value: string): number {
  let cjk = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    // CJK 字符
    if ((code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x3000 && code <= 0x303f) ||
        (code >= 0xff00 && code <= 0xffef)) {
      cjk++;
    }
  }
  const ascii = value.length - cjk;
  return Math.ceil(ascii / 4 + cjk * 0.7);
}
```

---

## 6. 上下文快照

每次生成上下文包时，自动写入 `task_context_snapshots` 表：

| 字段 | 说明 |
|------|------|
| `taskId` | 关联任务 |
| `stageId` | 关联阶段 |
| `policy` | 使用的上下文策略 |
| `memoryMode` | 记忆模式 |
| `content` | 上下文包内容 |
| `tokenEstimate` | token 估算值 |

用途：
- 审计：追溯每次 agent 调用收到的上下文
- 调优：分析 token 使用情况，调整权重配置
- 复盘：复现 agent 运行时的完整上下文

---

## 7. 变更历史

| 日期 | 版本 | 变更说明 |
|------|------|----------|
| 2026-05-15 | v0.1 | 初始版本，对齐 think.md §3、§7 |