# 记忆设置面板：从任务级选择器迁移到项目级配置

## Context

当前 Composer 中的 `memoryMode` 选择器（off/taskSummary/projectMemory）要求用户在创建任务时做前置决策，但用户此时通常不清楚是否需要项目记忆。且 `off` 模式语义模糊：选了“关闭记忆”后，任务完成仍会提取草稿；`taskSummary` 实际不注入任何项目记忆内容。

**目标**：移除 Composer 中的记忆选择器，改为 Topbar Settings 图标弹出项目级设置面板。新任务默认遵循项目级设置，系统自动决定项目记忆是否注入、任务完成后是否提取记忆草稿。

## 设计原则

1. **不让用户在创建任务前理解记忆策略**：Composer 只保留任务模式、预算、权限等执行参数。
2. **项目级开关只影响新行为**：设置变更后影响后续上下文构建和后续任务完成后的提取逻辑，不批量改写历史任务。
3. **历史任务可追溯**：已有任务的 `memoryMode`、`contextPolicy`、上下文快照仍可正常展示。
4. **快照记录实际行为**：上下文快照中的 `memoryMode` 记录本次上下文构建的实际结果，而不是只记录抽象的 `auto`。
5. **注入和提取分离**：`memoryInjectEnabled` 控制上下文包是否注入已确认项目记忆；`memoryExtractEnabled` 控制任务完成后是否生成待确认记忆草稿。

## 行为定义

### 新任务默认策略

新创建任务不再从前端提交 `memoryMode` 和 `contextPolicy`。

后端创建任务时：

- `memoryMode` 默认写入 `"auto"`，表示该任务使用项目级记忆设置。
- `contextPolicy` 默认写入 `"auto"`，表示默认上下文策略；如果后续显式选择消息进入上下文，可追加 `+selectedMessages`。

> 注意：这要求 `MemoryMode` 类型扩展为 `"off" | "taskSummary" | "projectMemory" | "auto"`。旧任务的旧值继续兼容。

### 上下文注入规则

`buildContextPackage()` 构建上下文时：

1. 如果任务 `memoryMode !== "auto"`，按历史任务语义兼容处理：
   - `"off"`：不注入项目记忆。
   - `"taskSummary"`：不注入项目记忆，仅保留当前任务摘要语义。
   - `"projectMemory"`：注入项目已确认记忆。
2. 如果任务 `memoryMode === "auto"`，读取 `project_settings.memoryInjectEnabled`：
   - `false`：不注入项目记忆，快照 `memoryMode` 记录为 `"off"`。
   - `true` 且有已确认项目记忆：注入记忆，快照 `memoryMode` 记录为 `"projectMemory"`。
   - `true` 但无已确认项目记忆：不注入具体记忆内容，快照 `memoryMode` 可记录为 `"projectMemory"`，上下文中说明“暂无已确认项目记忆”。

当前版本不做语义相关性检索。所谓“自动”只表示按项目开关自动注入项目下最近的已确认记忆，不表示按任务 prompt 做向量检索或 LLM 相关性判断。

### 记忆提取规则

任务完成后：

- 若项目设置 `memoryExtractEnabled === false`，跳过 `extractMemoryFromTask()`。
- 若 `memoryExtractEnabled === true`，沿用现有提取逻辑，生成 draft 状态记忆，仍需用户确认后才进入上下文。
- 提取失败不影响任务完成状态。

## 实施步骤

### 第 1 步：数据层

**`src/lib/types.ts`**

1. 扩展 `MemoryMode`：

```typescript
export type MemoryMode = "off" | "taskSummary" | "projectMemory" | "auto";
```

2. 新增项目设置接口：

```typescript
export interface ProjectSettings {
  projectId: string;
  memoryInjectEnabled: boolean;
  memoryExtractEnabled: boolean;
  updatedAt: string;
}
```

3. `CreateTaskInput` 可保留 `memoryMode?` 和 `contextPolicy?` 作为内部兼容字段，但公开 API 校验不再接收这两个字段。

**`src/lib/server/db.ts`**

1. `migrate()` 中新增 `project_settings` 表：

```sql
CREATE TABLE IF NOT EXISTS project_settings (
  projectId TEXT PRIMARY KEY,
  memoryInjectEnabled INTEGER NOT NULL DEFAULT 1,
  memoryExtractEnabled INTEGER NOT NULL DEFAULT 1,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(projectId) REFERENCES projects(id) ON DELETE CASCADE
);
```

2. 新增 `getProjectSettings(projectId)`：
   - 先校验项目存在，不存在则抛出“项目不存在”。
   - 若设置记录不存在，插入默认值：注入开启、提取开启。
   - 返回布尔化后的 `ProjectSettings`。

3. 新增 `upsertProjectSettings(projectId, patch)`：
   - 先调用 `getProjectSettings(projectId)` 确保记录存在。
   - 只更新传入的字段。
   - 每次更新刷新 `updatedAt`。
   - 返回更新后的 `ProjectSettings`。

4. 修改 `createTask()` 默认值：
   - `memoryMode: input.memoryMode || "auto"`
   - `contextPolicy: input.contextPolicy || "auto"`

5. `task_context_snapshots.memoryMode` 继续保存 `MemoryMode`，允许保存 `"auto"`，但新逻辑应优先保存实际行为值。

### 第 2 步：API 层

**`src/lib/server/validation.ts`**

1. 从 `createTaskSchema` 移除 `memoryMode` 和 `contextPolicy`，避免前端继续提交任务级记忆策略。
2. 新增：

```typescript
export const projectSettingsSchema = z.object({
  memoryInjectEnabled: z.boolean().optional(),
  memoryExtractEnabled: z.boolean().optional(),
}).strict().refine(
  (value) => value.memoryInjectEnabled !== undefined || value.memoryExtractEnabled !== undefined,
  "至少需要提供一个设置项",
);
```

**新建 `src/app/api/projects/[projectId]/settings/route.ts`**

- `GET`：调用 `getProjectSettings(projectId)`，返回 `{ settings }`。
- `PUT`：使用 `projectSettingsSchema` 校验请求体，调用 `upsertProjectSettings()`，返回 `{ settings }`。
- `runtime = "nodejs"`。
- `dynamic = "force-dynamic"`。
- 项目不存在返回 404。
- 请求体非法返回 400。

### 第 3 步：核心逻辑改造

**`src/lib/server/context.ts`**

1. 引入 `getProjectSettings()`。
2. 重构 `memorySection()`，建议返回内容和实际模式：

```typescript
type MemorySectionResult = {
  content: string;
  effectiveMemoryMode: MemoryMode;
};
```

3. 签名调整为：

```typescript
function memorySection(task: TaskWithRelations, maxChars: number): MemorySectionResult
```

4. 处理逻辑：
   - 旧任务 `off/taskSummary/projectMemory` 按旧语义处理。
   - 新任务 `auto` 读取项目设置后决定实际注入行为。
   - 项目记忆查询继续使用 `searchProjectMemory(projectId, { categories, status: "confirmed", limit: 5 })`。

5. `buildContextPackage()` 中：
   - 用 `memorySectionResult.content` 拼上下文。
   - `ContextPackage.memoryMode` 使用 `memorySectionResult.effectiveMemoryMode`。
   - `policy` 保留现有 `selectedMessages` 追加逻辑。若原始 `contextPolicy === "auto"` 且追加消息，则结果为 `"auto+selectedMessages"`。

6. `metadataSection()` 中建议同时展示：
   - `任务记忆策略：${task.memoryMode}`
   - `本次实际记忆模式：${contextPackage.memoryMode}` 可通过调整参数或在记忆 section 中说明。

**`src/lib/server/scheduler.ts`**

在 `extractMemoryFromTask()` 调用前读取项目设置：

```typescript
const settings = getProjectSettings(completedTask.projectId);
if (settings.memoryExtractEnabled) {
  extractMemoryFromTask(completedTask);
}
```

提取失败仍吞掉异常，不影响任务完成。

**`src/app/api/tasks/[taskId]/switch-agent/route.ts`**

检查派生/切换 agent 时是否仍复制源任务的 `memoryMode` 和 `contextPolicy`。

建议规则：

- 派生任务若代表同一任务的 agent 切换，可复制源任务策略，保持上下文一致。
- 新建独立任务走默认 `"auto"`。
- 如果继续使用 `contextPackage.policy`，确认其可能为 `"auto+selectedMessages"`，不会破坏后续判断。

### 第 4 步：UI 改造

**`src/components/composer/Composer.tsx`**

- 从 `ComposerProps` 移除 `memoryMode` 和 `onMemoryModeChange`。
- 删除 memoryMode 的 `<Select>` 组件。
- 移除 `MemoryMode` 类型导入。

**`src/components/workbench.tsx`**

移除：

- `const [memoryMode, setMemoryMode] = useState<MemoryMode>("taskSummary")`
- 传给 Composer 的 `memoryMode` 和 `onMemoryModeChange` props
- `createTask()` 请求体中的 `memoryMode` 和 `contextPolicy`
- `MemoryMode` 类型导入

新增：

- `const [showSettings, setShowSettings] = useState(false)`
- `const settingsBtnRef = useRef<HTMLButtonElement>(null)`
- Settings 按钮添加 `ref={settingsBtnRef}` 和 `onClick={() => setShowSettings(true)}`
- Settings 按钮在无选中项目时 `disabled`
- 在按钮后添加 `<ProjectSettingsPopover>` 组件

**新建 `src/components/settings/ProjectSettingsPopover.tsx`**

职责：

- 打开时加载项目设置和已确认记忆列表。
- 使用现有 `Popover` 组件，传入 `triggerRef`。
- 开关切换采用乐观更新；请求失败时回滚并展示错误。
- `projectId` 变化时重新加载数据。
- `open === false` 时不发请求。

结构：

```text
ProjectSettingsPopover (projectId, open, onClose, triggerRef)
├── 头部：项目设置
├── 配置区
│   ├── 记忆注入：Toggle + 说明文字
│   └── 记忆提取：Toggle + 说明文字
├── 分隔线
└── 已确认记忆列表
    └── 每条记忆：分类标签 + 内容摘要 + 删除按钮
```

数据流：

- 设置：`GET /api/projects/:projectId/settings`
- 更新：`PUT /api/projects/:projectId/settings`
- 记忆列表：`GET /api/projects/:projectId/memory?status=confirmed`
- 删除记忆：`DELETE /api/projects/:projectId/memory/:memoryId`

**新建 `src/components/settings/MemoryToggle.tsx`**

- 独立 Toggle 控件：label + description + switch。
- 使用 `button role="switch"` 或 checkbox，保证键盘可访问。
- 支持 `disabled` 和 loading 状态。

**新建 `src/components/settings/ConfirmedMemoryList.tsx`**

- 展示已确认记忆：分类标签、内容摘要、创建/确认时间、删除操作。
- 删除成功后从本地列表移除。
- 空状态显示“暂无已确认项目记忆”。
- 删除按钮需有 `aria-label`。

**新建 `src/app/styles/settings.css`**

- 设置面板样式控制在约 100 行。
- 在 `src/app/globals.css` 中 `@import "./styles/settings.css";`。
- 避免把设置面板做成嵌套卡片；使用 Popover 内容区域和分隔线即可。

## 文件修改清单

| 文件 | 操作 |
|------|------|
| `src/lib/types.ts` | 修改：扩展 `MemoryMode`，新增 `ProjectSettings` 接口 |
| `src/lib/server/db.ts` | 修改：新增表迁移、设置读写函数、任务默认值 |
| `src/lib/server/context.ts` | 修改：重构项目记忆注入逻辑，快照记录实际模式 |
| `src/lib/server/scheduler.ts` | 修改：按项目设置条件化记忆提取 |
| `src/lib/server/validation.ts` | 修改：创建任务移除记忆字段，新增设置校验 |
| `src/app/api/projects/[projectId]/settings/route.ts` | 新建：项目设置 GET/PUT |
| `src/app/api/tasks/[taskId]/switch-agent/route.ts` | 检查/必要时调整策略继承逻辑 |
| `src/components/composer/Composer.tsx` | 修改：移除 memoryMode 相关 UI 和 props |
| `src/components/workbench.tsx` | 修改：移除任务级记忆状态，添加设置面板交互 |
| `src/components/settings/ProjectSettingsPopover.tsx` | 新建 |
| `src/components/settings/MemoryToggle.tsx` | 新建 |
| `src/components/settings/ConfirmedMemoryList.tsx` | 新建 |
| `src/app/styles/settings.css` | 新建 |
| `src/app/globals.css` | 修改：添加 settings 样式导入 |
| `CHANGELOG.md` | 修改：记录本次功能变更 |

## 兼容性要求

1. 旧任务的 `memoryMode` 值为 `off/taskSummary/projectMemory` 时，历史展示和上下文构建不报错。
2. 旧任务的 `contextPolicy` 值为 `taskSummary/projectMemory/off` 时，不因新默认值 `"auto"` 破坏 `selectedMessages` 判断。
3. 新任务创建接口即使前端不传 `memoryMode/contextPolicy` 也能正常入库。
4. 数据库已有项目不需要手动迁移设置记录，首次读取时自动创建默认设置。
5. 删除项目时，`project_settings` 记录随项目级联删除。

## 验收标准

1. `pnpm build` 编译无错误。
2. 创建任务时 Composer 不再显示记忆选择器。
3. 创建任务请求体不包含 `memoryMode` 和 `contextPolicy`。
4. 新任务入库后 `memoryMode === "auto"`，`contextPolicy === "auto"`。
5. 点击 Topbar Settings 图标弹出设置面板。
6. 无选中项目时 Settings 按钮 disabled。
7. 首次打开设置面板时，如果项目没有设置记录，会自动创建默认设置并展示两个开启状态。
8. 切换“记忆注入”关闭后，新任务上下文包不注入已确认项目记忆，快照实际 `memoryMode` 为 `"off"`。
9. 切换“记忆注入”开启且存在已确认记忆时，新任务上下文包注入项目记忆，快照实际 `memoryMode` 为 `"projectMemory"`。
10. 切换“记忆提取”关闭后，任务完成不生成新的 draft 记忆。
11. 切换“记忆提取”开启后，任务完成沿用现有规则生成 draft 记忆。
12. 已确认记忆列表可浏览和删除；删除后列表即时更新。
13. 已有旧任务（`memoryMode` 非 `"auto"`）仍可正常查看和构建上下文。
14. `PUT /api/projects/:projectId/settings` 对非法请求体返回 400，对不存在项目返回 404。

## 非目标

本次不实现以下能力：

- 向量检索或 embedding 相关性匹配。
- LLM 判断记忆和当前任务的相关性。
- 记忆编辑功能。
- 任务级临时覆盖项目记忆设置。
- 批量迁移旧任务的 `memoryMode/contextPolicy`。
