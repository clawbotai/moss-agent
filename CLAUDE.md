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
