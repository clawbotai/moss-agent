# AGENTS.md

注意事项：

- 所有回复必须使用简体中文。
- 本项目是本地 agent 协作调度平台，默认技术栈为 Next.js、TypeScript、SQLite。
- 涉及本机文件系统、SQLite、子进程的代码必须运行在 Node.js runtime，不能使用 Edge runtime。
- 数据库、CLI、外部 SDK 必须懒加载，避免 Next.js 构建阶段初始化本地资源。
