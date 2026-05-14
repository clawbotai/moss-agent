export function nowIso() {
  return new Date().toISOString();
}

export function shortTitle(input: string, maxLength = 28): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) return "未命名任务";

  // 使用 Array.from 正确处理 Unicode 字符
  const chars = Array.from(compact);
  if (chars.length <= maxLength) return compact;

  // 截断并在最后一个完整词处停止
  const truncated = chars.slice(0, maxLength).join("");
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > maxLength * 0.6 ? `${truncated.slice(0, lastSpace)}...` : `${truncated}...`;
}
