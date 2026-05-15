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

### Changed
- 当前任务输入说明默认追加到当前任务，只有点击顶部“新开任务”后才创建独立任务
- 任务详情移除顶部 detailHeader，让对话时间线直接作为详情主体展示

### Added
- 任务详情支持会话式展示，用户问题和 Moss 交付回答作为主线，幕后协作默认收起
- 任务详情支持按执行时间线展示追加消息，用户补充会跟随当前任务进度显示在后续位置
- 上下文与记忆系统设计方案文档（`docs/context-memory-design.md`），对齐 think.md 设计原则
- 上下文包规范文档（`docs/context-spec.md`）
- CHANGELOG.md 变更日志
