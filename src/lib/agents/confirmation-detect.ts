/**
 * 纯检测逻辑模块——无服务端依赖，客户端和服务端均可安全导入。
 *
 * 从 agent 输出中检测确认请求，支持两种方式：
 * 1. 显式格式：[CONFIRM] 问题描述 / [OPTIONS] 选项 / [DEFAULT] 默认值
 * 2. 智能检测：检测输出中包含选项的问题（保守策略，需意图关键词）
 */

import type { AgentConfirmationRequest } from "./types";

export function detectConfirmationRequest(output: string, skipJsonExtraction = false): AgentConfirmationRequest | undefined {
  const normalizedOutput = skipJsonExtraction ? output : normalizeAgentOutput(output);

  const explicitResult = detectExplicitConfirmation(normalizedOutput);
  if (explicitResult) return { ...explicitResult, rawOutput: normalizedOutput };

  const smartResult = detectSmartConfirmation(normalizedOutput);
  if (smartResult) return { ...smartResult, rawOutput: normalizedOutput };

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

function detectExplicitConfirmation(output: string): AgentConfirmationRequest | undefined {
  const rawLines = output.split("\n");

  let question: string | null = null;
  const allOptions: string[] = [];
  let defaultOption: number | undefined;

  let collectingOptions = false;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();

    const confirmMatch = line.match(/^\[CONFIRM\]\s*(.+)$/i);
    if (confirmMatch) {
      question = confirmMatch[1].trim();
      collectingOptions = false;
      continue;
    }

    // 支持两种格式：
    // 1. 同行：[OPTIONS] 选项1 | 选项2 | 选项3
    // 2. 下行编号列表：[OPTIONS]\n1. 选项1\n2. 选项2
    const optionsInlineMatch = line.match(/^\[OPTIONS\]\s*(.+)$/i);
    if (optionsInlineMatch) {
      const parsed = optionsInlineMatch[1]
        .split("|")
        .map((opt) => opt.trim())
        .filter(Boolean);
      allOptions.push(...parsed);
      collectingOptions = false;
      continue;
    }

    const optionsEmptyMatch = line.match(/^\[OPTIONS\]\s*$/i);
    if (optionsEmptyMatch) {
      collectingOptions = true;
      continue;
    }

    // 收集 [OPTIONS] 后的编号/无序/缩进续行列表项
    if (collectingOptions) {
      const numberedMatch = line.match(/^(?:\d+[.、）)]\s*|[-•]\s+)(.+)$/);
      if (numberedMatch) {
        allOptions.push(cleanMarkdown(numberedMatch[1]));
        continue;
      }
      // 缩进续行：保留原始行判断缩进，内容追加到上一选项
      if (rawLine.match(/^\s{2,}/) && allOptions.length > 0) {
        allOptions[allOptions.length - 1] += " " + cleanMarkdown(line);
        continue;
      }
      // 遇到空行、标签或非列表行，停止收集
      collectingOptions = false;
    }

    const defaultMatch = line.match(/^\[DEFAULT\]\s*(\d+)$/i);
    if (defaultMatch) {
      defaultOption = parseInt(defaultMatch[1], 10);
      collectingOptions = false;
      continue;
    }
  }

  if (!question) return undefined;

  const options = allOptions.length > 0 ? allOptions : undefined;

  if (defaultOption !== undefined && options && defaultOption >= options.length) {
    defaultOption = undefined;
  }

  return {
    question,
    options,
    defaultOption,
  };
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function detectSmartConfirmation(output: string): AgentConfirmationRequest | undefined {
  const lines = output.split("\n");

  const intentKeywords = /(?:请选择|请确认|请你|等你|等待你|请告诉我|请回复|需要你|等你回复|请回答)/;

  const fullText = lines.map((l) => cleanMarkdown(l)).join(" ");
  if (!intentKeywords.test(fullText)) return undefined;

  const tailStart = Math.max(0, lines.length - 30);
  const tailLines = lines.slice(tailStart);

  const questionPatterns = [
    /(?:Q\d+[：:]\s*|(?:问题\d+[：:]\s*))(.+)[？?]/i,
    /^\d+[.、）)]\s*(.+)[？?]\s*$/,
  ];

  const optionPatterns = [
    /[-•]\s*\(?[A-Da-d]\)?[）).：:：]\s*(.+)/,
    /\(?[A-Da-d]\)?[）).：:：]\s*(.+)/,
  ];

  let currentQuestion: string | null = null;
  let currentOptions: string[] = [];
  let questionIndex = -1;

  for (let i = 0; i < tailLines.length; i++) {
    const line = cleanMarkdown(tailLines[i]);

    if (line === "") continue;

    let isQuestion = false;
    for (const pattern of questionPatterns) {
      const match = line.match(pattern);
      if (match) {
        if (currentQuestion && currentOptions.length >= 2) {
          return { question: currentQuestion, options: currentOptions };
        }
        currentQuestion = match[1].trim();
        currentOptions = [];
        questionIndex = i;
        isQuestion = true;
        break;
      }
    }

    if (isQuestion) continue;

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

  if (currentQuestion && currentOptions.length >= 2) {
    return { question: currentQuestion, options: currentOptions };
  }

  // 备用检测：以问号结尾 + 意图关键词的行 + 后续有选项
  let questionLine: string | null = null;
  let questionLineIndex = -1;
  let fallbackOptions: string[] = [];

  for (let i = 0; i < tailLines.length; i++) {
    const line = cleanMarkdown(tailLines[i]);

    if ((line.endsWith("？") || line.endsWith("?")) && line.length > 10) {
      if (intentKeywords.test(line)) {
        if (questionLine && fallbackOptions.length >= 2) {
          return { question: questionLine, options: fallbackOptions };
        }
        questionLine = line;
        questionLineIndex = i;
        fallbackOptions = [];
        continue;
      }
    }

    if (questionLine && i > questionLineIndex) {
      for (const pattern of optionPatterns) {
        const match = line.match(pattern);
        if (match) {
          fallbackOptions.push(match[1].trim());
          break;
        }
      }
    }
  }

  if (questionLine && fallbackOptions.length >= 2) {
    return { question: questionLine, options: fallbackOptions };
  }

  return undefined;
}