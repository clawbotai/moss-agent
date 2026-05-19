# Changelog

This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added
- Composer 技能选择与调用功能：用户可在 composer 中查看、搜索和选择技能，选中的技能会注入到对应 agent 的执行上下文
  - 新增 Skill Registry (`src/lib/server/skills.ts`)：扫描本机可用技能，支持内置命令、Claude skills (`~/.claude/skills/`)、Codex skills (`~/.codex/skills/`) 和项目 skills
  - 非内置 skill 使用来源前缀生成稳定 ID，避免不同来源同名 skill 互相冲突
  - 新增 `GET /api/skills` API：返回可用技能列表，支持按 mode 过滤和刷新缓存
  - 数据库新增 `skillSelectionJson` 和 `pendingSkillSelectionJson` 字段，支持技能选择持久化
  - 支持任务创建和追加消息时携带技能选择，技能会在对应 agent 阶段注入到 prompt
  - Claude adapter 注入技能调用说明（名称 + 描述 + 精简 SKILL.md 内容）
  - Codex adapter 注入技能摘要（结构化提取优先级，6000 字符上限）
  - 新增前端组件：SkillTriggerButton、SkillPalette、SkillPaletteItem、SelectedSkillChips
  - 技能面板支持搜索、键盘导航（↑/↓/Enter/Esc）、分组显示和 agent 标签
  - 已选技能以 chip 形式展示，支持点击移除
  - 支持按模式过滤技能：codexOnly 只显示 Codex 技能，claudeOnly 只显示 Claude 技能
  - 内置命令（compact、clear、context、add-dir）现在也可以选择，会在 prompt 中注入命令提示让 agent 自行决定使用时机
  - 运行中任务切换技能时保存到 pendingSkillSelection，下一轮执行自动应用
  - 技能文件不存在时优雅降级：warn 日志 + 跳过注入，任务不崩溃
- Agent 确认交互功能：当 Claude 或 Codex 在执行任务时遇到需求边界问题（需求不明确、存在多种实现方式需要选择等），系统自动检测并暂停任务，等待用户通过 UI 确认后再继续执行
  - 扩展 AgentRunResult 类型，添加 confirmationRequest 字段让 agent 可以表明需要用户确认
  - 新增确认请求智能检测机制，自动识别多种问题格式：
    - 显式格式：agent 可通过 [CONFIRM]、[OPTIONS]、[DEFAULT] 格式输出确认请求
    - 编号问题格式：`**1. 你的核心场景是什么？**` + 列表选项
    - Q1/Q2/Q3 格式：`**Q1：...？**` + A/B/C 选项
  - 调度器支持暂停任务等待用户确认，任务状态变为 "waiting"
  - 新增 `/api/tasks/[taskId]/confirm` API 端点处理用户确认回复
  - UI 新增 ConfirmationDialog 组件，支持选项选择和自由文本输入两种确认方式
  - 确认对话框支持用户自定义回复：即使 agent 提供了选项，用户仍可选择"自定义回复"输入任意文本
  - 确认对话框展示 agent 完整输出上下文：支持多组 [OPTIONS] 标签，对话框可折叠查看 agent 提问详情（markdown 渲染）
  - 兼容已有等待任务：从 stage 日志中自动提取 agent 完整输出作为上下文
  - 任务详情页自动检测等待确认状态并展示确认交互界面
  - 支持 ANSI 转义码清理，确保 CLI 输出检测准确性
  - 用户确认回复会写入当前任务消息并注入下一次 agent 恢复上下文，确保确认后能继续当前阶段
  - 支持从 Codex JSON 事件输出中提取确认标记
  - 用户取消确认时任务正确停止（状态变为 cancelled）

### Fixed
- 修复技能选择 code review 发现的问题：追加任务保留原有 skillSelection，pending skill JSON 使用安全解析；服务端拒绝 mode 不兼容的 skill bucket；技能面板按模式过滤可选项；`GET /api/skills` 校验 mode 参数；忽略 `.sisyphus` 运行状态文件
- 修复全量 lint 阻塞项：`useTaskConfirmation` 不再在 render 阶段写 ref；测试脚本移除 unused/any；进程树终止逻辑改用 `execFileSync`
- 修复确认对话框选项丢失导致点击确认无反应的问题：Agent 输出 `[OPTIONS]` 后接编号列表（如 `1. 方案A\n2. 方案B`）时，正则只匹配同行内容导致 options 为空，对话框退化为纯文本输入。检测逻辑新增对 `[OPTIONS]` 后接编号/无序/缩进续行列表格式支持；`TaskDetail` 在从 stage 日志恢复 rawOutput 时重新运行检测以补充 options
- 修复确认 API 错误被静默吞没的问题：`useTaskConfirmation` hook 新增 `error` 状态返回，`ConfirmationDialog` 在操作按钮旁展示错误提示
- 修复客户端组件与服务端模块耦合风险：纯检测逻辑提取到 `confirmation-detect.ts`（无服务端依赖），`confirmation.ts` 仅保留 re-export 和 prompt 构建函数
- 更新确认请求 prompt 指令，同时文档化管道分隔和编号列表两种 `[OPTIONS]` 格式
- 修复简单任务（codexOnly/claudeOnly）上下文过重的问题：单阶段任务首次执行时直接使用用户指令，跳过冗余的上下文包构建（阶段摘要、交付摘要等），避免 token 浪费
- 修复新开任务/切换项目时协作模式未重置的问题：点"新开任务"或切换项目后 mode 回到默认的 collaborative，避免沿用上一个任务的 codexOnly/claudeOnly 设置
- 修复追加任务时切换模式不生效的问题：追加消息时将当前 Composer 选中的 mode 传给后端，后端使用新模式构建执行阶段，而非沿用任务原始模式
- 修复运行中任务切换模式被静默忽略的问题：新增 `pendingMode` 字段，任务运行中切换模式时保存待生效模式，任务完成后再次追加时自动应用
- 修复 Codex 输出摘要提取错误的问题：Codex CLI 的 JSON 输出中 `item.completed` 事件包含 `item.text` 字段，但摘要提取函数未解析此字段，导致 fallback 到 stderr 的 "Reading additional input from stdin..."
- 修复进行中任务（queued/running/waiting/stuck）仍显示 Moss 回答的问题：最后一个对话轮次的阶段回答和 agent 消息均在任务完成后才展示，简化用户输入标签为 "User"
- 修复当前任务追加说明后只保存不执行的问题：已结束任务会在原任务内追加后续执行阶段并重新入队。
- 修复当前任务下点击发送会创建派生任务的问题，改为追加消息到当前任务。
- 修复 code review 发现的问题：messages 路由 catch 块静默吞错改为 console.warn、scheduler 单例守卫简化为存在性检查、workbench projectId 同步 effect 补充设计意图注释
- 修复当前任务追加说明后不广播任务更新、直达任务页项目状态可能未同步导致看似无响应的问题
- 修复 Codex 审查阶段传入 `--uncommitted -` 导致 CLI 参数互斥、计划审查中断的问题
- 修复 code review 发现的问题：continueAfterMessage 竞态条件防护、continue 路由验证冗余清理、移除未使用的 continueTaskSchema
- 修复 code review 发现的问题：createTaskSchema 添加 `.strict()` 拒绝已移除的 `memoryMode`/`contextPolicy` 字段，返回 400 而非静默忽略
- 修复设置面板切换项目时旧项目数据残留问题：加载开始时清空 settings 和 memories 状态
- 修复 code review 发现的问题：确认交互流程健壮性改进
  - 确认请求 JSON 不再在时间线中以原始格式展示（waiting 状态跳过 error entry 渲染）
  - confirm API 使用自定义 `ConfirmError` 类型替代字符串匹配判断 HTTP 状态码
  - confirm API 和前端 textarea 添加 4000 字符长度上限
  - `confirmAndContinue` 使用原子性 `confirmTaskToRunning` 防止并发确认竞态
  - 服务重启后确认回复上下文不丢失：`consumeConfirmationResumeHint` 增加数据库 fallback
  - ConfirmationDialog 选项添加 `:focus-within` 键盘焦点样式，textarea 添加 maxLength
  - 智能检测误报率优化：意图关键词守卫 + 仅扫描末尾 30 行 + 收紧选项模式 + 统一主/备用检测关键词策略
  - Codex 适配器确认检测跳过重复 JSON 解包（`skipJsonExtraction` 参数）
  - `useTaskConfirmation` 使用 ref 模式避免 inline callback 导致 useCallback 重创建

### Changed
- 设置面板默认选中通用模块，导航菜单通用排在记忆之前。
- 记忆设置从 Composer 任务级选择器迁移到 Topbar 项目级设置面板，新任务默认 `memoryMode=auto`，系统根据项目设置自动决定记忆注入和提取行为。
- 设置面板重构为左侧导航+右侧内容的分栏布局，支持多模块扩展（记忆、通用等）。
- Composer 移除记忆模式选择器，减少用户创建任务前的决策负担。
- 上下文快照记录本次实际记忆模式（`effectiveMemoryMode`），而非抽象的 `auto`。
- 任务详情主流输出改为”用户输入任务 / Moss 回答”交替展示，并保留协作阶段与日志折叠详情。
- 默认协作流保留 Claude Code 审核阶段，审核产出作为 Moss 回答展示，避免审核结果和最终回答重复。
- 新任务不再生成“汇总交付”阶段，历史遗留 summarize 阶段执行时会被跳过。
- 当前任务输入说明默认追加到当前任务，只有点击顶部“新开任务”后才创建独立任务
- 任务详情移除顶部 detailHeader，让对话时间线直接作为详情主体展示

### Added
- 交互微动画：Popover 缩放入场、设置面板遮罩渐显+滑入、Toggle 弹性缓动、Timeline 展开/折叠平滑过渡、按钮按压反馈、下拉箭头旋转、状态点平滑过渡、记忆项入场动画
- 任务详情支持会话式展示，用户问题和 Moss 交付回答作为主线，幕后协作默认收起
- 任务详情支持按执行时间线展示追加消息，用户补充会跟随当前任务进度显示在后续位置
- 上下文与记忆系统设计方案文档（`docs/context-memory-design.md`），对齐 think.md 设计原则
- 上下文包规范文档（`docs/context-spec.md`）
- CHANGELOG.md 变更日志
