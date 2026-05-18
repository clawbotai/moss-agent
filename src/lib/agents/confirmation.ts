import type { AgentConfirmationRequest } from "./types";

/**
 * 从 agent 输出中检测确认请求
 * 支持两种方式：
 * 1. 显式格式：[CONFIRM] 问题描述 / [OPTIONS] 选项 / [DEFAULT] 默认值
 * 2. 智能检测：检测输出中包含多个选项的问题
 */
export function detectConfirmationRequest(output: string): AgentConfirmationRequest | undefined {
  const normalizedOutput = normalizeAgentOutput(output);

  // 方式 1：检测显式格式
  const explicitResult = detectExplicitConfirmation(normalizedOutput);
  if (explicitResult) return explicitResult;

  // 方式 2：智能检测包含选项的问题
  const smartResult = detectSmartConfirmation(normalizedOutput);
  if (smartResult) return smartResult;

  return undefined;
}

function normalizeAgentOutput(output: string): string {
  const lines = output.split("\n");
  const extracted: string[] = [];
  let parsedJsonLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as unknown;
      const texts = extractJsonText(event);
      if (texts.length > 0) {
        parsedJsonLine = true;
        extracted.push(...texts);
      }
    } catch {
      extracted.push(trimmed);
    }
  }

  return parsedJsonLine && extracted.length > 0 ? extracted.join("\n") : output;
}

function extractJsonText(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const texts: string[] = [];

  for (const key of ["message", "content", "delta"]) {
    const field = record[key];
    if (typeof field === "string") texts.push(field);
  }

  const item = record.item;
  if (item && typeof item === "object") {
    const text = (item as Record<string, unknown>).text;
    if (typeof text === "string") texts.push(text);
  }

  return texts;
}

/**
 * 检测显式 [CONFIRM] 格式
 */
function detectExplicitConfirmation(output: string): AgentConfirmationRequest | undefined {
  const lines = output.split("\n").map((line) => line.trim());

  let question: string | null = null;
  let options: string[] | undefined;
  let defaultOption: number | undefined;

  for (const line of lines) {
    // 检测确认请求标记
    const confirmMatch = line.match(/^\[CONFIRM\]\s*(.+)$/i);
    if (confirmMatch) {
      question = confirmMatch[1].trim();
      continue;
    }

    // 检测选项列表
    const optionsMatch = line.match(/^\[OPTIONS\]\s*(.+)$/i);
    if (optionsMatch) {
      options = optionsMatch[1]
        .split("|")
        .map((opt) => opt.trim())
        .filter(Boolean);
      continue;
    }

    // 检测默认选项
    const defaultMatch = line.match(/^\[DEFAULT\]\s*(\d+)$/i);
    if (defaultMatch) {
      defaultOption = parseInt(defaultMatch[1], 10);
      continue;
    }
  }

  if (!question) return undefined;

  // 校验 defaultOption 不越界
  if (defaultOption !== undefined && options && defaultOption >= options.length) {
    defaultOption = undefined;
  }

  return {
    question,
    options,
    defaultOption,
  };
}

/**
 * 清理 markdown 格式符号和 ANSI 转义码
 */
function cleanMarkdown(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

/**
 * 智能检测包含选项的问题
 * 支持多种格式：
 * - Q1: ... / Q1、... / 问题1：...
 * - 1. ... / 1、... / **1. ...**
 * - 以问号结尾且包含选项的段落
 */
function detectSmartConfirmation(output: string): AgentConfirmationRequest | undefined {
  const lines = output.split("\n");

  // 检测问题行的多种模式
  const questionPatterns = [
    /(?:Q\d+[：:]\s*|(?:问题\d+[：:]\s*))(.+)[？?]/i,  // Q1: ...? 或 问题1：...?
    /^\d+[.、）)]\s*(.+)[？?]\s*$/,  // 1. ...? 或 1、...? 或 1) ...?
  ];

  // 检测选项行的模式
  const optionPatterns = [
    /[-•]\s*\(?[A-Da-d]\)?[）).：:：]\s*(.+)/,  // - A) ... 或 - (A) ... 或 - A. ...
    /[-•]\s*(.+)/,  // - ... （无字母前缀）
    /\(?[A-Da-d]\)?[）).：:：]\s*(.+)/,  // A) ... 或 (A) ...
  ];

  let currentQuestion: string | null = null;
  let currentOptions: string[] = [];
  let questionIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = cleanMarkdown(rawLine);

    // 跳过空行
    if (line === "") {
      continue;
    }

    // 检测问题行
    let isQuestion = false;
    for (const pattern of questionPatterns) {
      const match = line.match(pattern);
      if (match) {
        // 如果之前有问题和选项，返回结果
        if (currentQuestion && currentOptions.length >= 2) {
          return {
            question: currentQuestion,
            options: currentOptions,
          };
        }
        currentQuestion = match[1].trim();
        currentOptions = [];
        questionIndex = i;
        isQuestion = true;
        break;
      }
    }

    if (isQuestion) continue;

    // 检测选项行（在问题行之后）
    if (currentQuestion && i > questionIndex) {
      for (const pattern of optionPatterns) {
        const match = line.match(pattern);
        if (match) {
          currentOptions.push(match[1].trim());
          break;
        }
      }
    }
  }

  // 检查最后一个问题
  if (currentQuestion && currentOptions.length >= 2) {
    return {
      question: currentQuestion,
      options: currentOptions,
    };
  }

  // 备用检测：仅当行以问号结尾且包含明确的选择关键词，且后续确实有选项行
  let questionLine: string | null = null;
  let questionLineIndex = -1;
  let allOptions: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = cleanMarkdown(lines[i]);

    // 检测以问号结尾的行（必须同时包含选择关键词）
    if ((line.endsWith("？") || line.endsWith("?")) && line.length > 10) {
      if (/(?:请|选择|哪种|哪个|什么|是否|还是|场景|阶段|执行者|方案|方式|来源|核心)/.test(line)) {
        // 如果之前有问题和选项，返回结果
        if (questionLine && allOptions.length >= 2) {
          return {
            question: questionLine,
            options: allOptions,
          };
        }
        questionLine = line;
        questionLineIndex = i;
        allOptions = [];
        continue;
      }
    }

    // 检测选项行（在问题行之后）
    if (questionLine && i > questionLineIndex) {
      for (const pattern of optionPatterns) {
        const match = line.match(pattern);
        if (match) {
          allOptions.push(match[1].trim());
          break;
        }
      }
    }
  }

  // 检查最后一个问题
  if (questionLine && allOptions.length >= 2) {
    return {
      question: questionLine,
      options: allOptions,
    };
  }

  return undefined;
}

/**
 * 构建确认请求提示（注入到 agent prompt 中）
 */
export function buildConfirmationInstruction(): string {
  return `
如果你在执行任务时遇到需要用户确认的情况（例如：需求不明确、存在多种实现方式需要选择、边界条件需要澄清等），请使用以下格式输出确认请求：

[CONFIRM] 你的问题描述
[OPTIONS] 选项1 | 选项2 | 选项3（可选，如果有多选方案）
[DEFAULT] 0（可选，默认选项的索引，从0开始）

然后停止执行，等待用户回复后再继续。
`;
}
