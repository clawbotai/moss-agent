# Moss Agent

Moss Agent 是一个本地运行的 Claude Code + Codex 协作调度平台。第一版使用 Next.js、TypeScript 和 SQLite，实现项目注册、任务编排、agent 诊断、实时日志和暗色 Web 工作台。

## 本地启动

当前项目默认使用 `pnpm`：

```bash
pnpm install
pnpm dev
```

启动后访问 `http://localhost:3000`。

如果本机没有 `pnpm`，先安装 pnpm 或通过 Corepack 启用。可以先运行诊断脚本查看本机环境：

```bash
node scripts/doctor.mjs
```

## 环境变量

可选配置：

```bash
MOSS_DATA_DIR=/Users/you/Library/Application Support/moss-agent
MOSS_CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
MOSS_CLAUDE_BIN=/opt/homebrew/bin/claude
```

不设置 `MOSS_DATA_DIR` 时，SQLite 数据会写入项目下的 `.moss-agent/moss-agent.sqlite`。

## 工作流

- 协作模式：Claude Code 生成计划，Codex 审查计划，Claude Code 修订计划，Codex 执行开发，Claude Code 审核结果，调度器汇总交付。
- Codex 直接模式：跳过 Claude Code，直接由 Codex 开发。
- Claude 直接模式：跳过 Codex，直接由 Claude Code 开发。
- 自定义 agent：预留扩展点，后续实现适配器即可接入。

## 主要接口

- `GET /api/projects`：项目列表。
- `POST /api/projects`：注册本机项目目录。
- `GET /api/tasks`：任务列表。
- `POST /api/tasks`：创建任务并入队。
- `GET /api/tasks/:taskId`：任务详情。
- `GET /api/tasks/:taskId/events`：任务 SSE 实时事件。
- `POST /api/tasks/:taskId/cancel`：取消任务。
- `POST /api/tasks/:taskId/continue`：卡住时继续等待。
- `POST /api/tasks/:taskId/retry`：重试任务。
- `POST /api/tasks/:taskId/switch-agent`：切换到 Claude 或 Codex 重新入队。
- `GET /api/agents/diagnostics`：agent 和包管理器诊断。
