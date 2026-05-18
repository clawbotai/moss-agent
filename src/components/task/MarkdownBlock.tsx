"use client";

import { Copy } from "lucide-react";
import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

function CopyButton({ text }: { text: string }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
  }, [text]);

  return (
    <button className="copyBtn" onClick={handleCopy} title="复制 Markdown" type="button">
      <Copy size={14} />
    </button>
  );
}

export function MarkdownBlock({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`markdownBlock ${className}`}>
      <CopyButton text={content} />
      <div className="markdownBody">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
