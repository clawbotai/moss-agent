# Changelog

This project follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Fixed
- 修复当前任务追加说明后只保存不执行的问题：已结束任务会在原任务内追加后续执行阶段并重新入队。
- 修复当前任务下点击发送会创建派生任务的问题，改为追加消息到当前任务。
- 修复 code review 发现的问题：messages 路由 catch 块静默吞错改为 console.warn、scheduler 单例守卫简化为存在性检查、workbench projectId 同步 effect 补充设计意图注释
- 修复当前任务追加说明后不广播任务更新、直达任务页项目状态可能未同步导致看似无响应的问题
- 修复 Codex 审查阶段传入 `--uncommitted -` 导致 CLI 参数互斥、计划审查中断的问题
- 修复 code review 发现的问题：continueAfterMessage 竞态条件防护、continue 路由验证冗余清理、移除未使用的 continueTaskSchema
- 修复 code review 发现的问题：createTaskSchema 添加 `.strict()` 拒绝已移除的 `memoryMode`/`contextPolicy` 字段，返回 400 而非静默忽略
- 修复设置面板切换项目时旧项目数据残留问题：加载开始时清空 settings 和 memories 状态

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
