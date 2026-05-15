# CLAUDE.md

本项目用于调度 Claude Code、Codex 以及后续可扩展 agent 协作完成本地项目任务。

默认协作流程：

1. Claude Code 生成计划。
2. Codex 审查计划。
3. Claude Code 修订计划。
4. Codex 执行开发。
5. Claude Code 审核结果。
6. 调度器汇总交付结果。

如果本机未安装 Claude Code CLI，平台应显示诊断提示，并允许用户改用 Codex 直接模式。

***注意***

- 所有回复必须使用简体中文。
- 本项目是本地 agent 协作调度平台，默认技术栈为 Next.js、TypeScript、SQLite。
- 涉及本机文件系统、SQLite、子进程的代码必须运行在 Node.js runtime，不能使用 Edge runtime。
- 数据库、CLI、外部 SDK 必须懒加载，避免 Next.js 构建阶段初始化本地资源。
- 每次提交记录在 CHANGELOG.md 记录

## 代码规模规范

### 组件文件（.tsx / .jsx）
- **阈值**：单文件不超过 **500 行**
- **拆分策略**：
  - 类型定义 → `types.ts`（接口、类型别名、常量集合）
  - 工具函数 → `utils.ts`（纯函数、数据转换、格式化）
  - 子组件 → 按功能域拆分为独立文件（如 `TimelineStage.tsx`、`MarkdownBlock.tsx`）
  - 主组件仅保留状态管理和组合逻辑
- **目录结构**：拆分文件与主组件同目录，使用相对路径 `./` 导入

### 样式文件（.css）
- **阈值**：单文件不超过 **500 行**
- **拆分策略**：
  - CSS 变量 → `styles/variables.css`
  - 布局样式 → `styles/layout.css`（Shell、Sidebar、Topbar、Content）
  - 功能模块 → 按组件域拆分（如 `timeline.css`、`markdown.css`、`composer.css`）
  - 全局入口文件通过 `@import` 导入各子模块
- **目录结构**：子模块放在 `styles/` 目录下

### 拆分检查清单
- [ ] 类型定义独立为 `types.ts`
- [ ] 纯函数独立为 `utils.ts`
- [ ] 可复用 UI 组件独立为单独文件
- [ ] CSS 按功能域拆分到 `styles/` 目录
- [ ] 拆分后 TypeScript 编译无错误
- [ ] 拆分后功能行为不变
