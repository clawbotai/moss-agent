/**
 * 确认请求模块——服务端入口。
 *
 * 纯检测逻辑已提取到 confirmation-detect.ts（客户端安全）。
 * 本模块重新导出检测函数以保持向后兼容，并保留仅服务端使用的 prompt 构建函数。
 */

export { detectConfirmationRequest } from "./confirmation-detect";

/**
 * 构建确认请求提示（注入到 agent prompt 中）
 */
export function buildConfirmationInstruction(): string {
  return `
如果你在执行任务时遇到需要用户确认的情况（例如：需求不明确、存在多种实现方式需要选择、边界条件需要澄清等），请使用以下格式输出确认请求：

[CONFIRM] 你的问题描述
[OPTIONS] 选项1 | 选项2 | 选项3（可选，如果有多选方案）
[DEFAULT] 0（可选，默认选项的索引，从0开始）

或者使用编号列表格式（适合选项描述较长的情况）：

[CONFIRM] 你的问题描述
[OPTIONS]
1. 选项描述1
2. 选项描述2
3. 选项描述3
[DEFAULT] 0

然后停止执行，等待用户回复后再继续。
`;
}