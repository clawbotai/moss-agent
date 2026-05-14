"use client";

import type { ReactNode } from "react";

interface GlowingBorderProps {
  children: ReactNode;
  className?: string;
  color?: "primary" | "success" | "warning" | "error";
}

const glowColors = {
  primary: "rgba(139, 124, 248, 0.3)",
  success: "rgba(52, 211, 153, 0.3)",
  warning: "rgba(251, 191, 36, 0.3)",
  error: "rgba(248, 113, 113, 0.3)",
};

export function GlowingBorder({ children, className = "", color = "primary" }: GlowingBorderProps) {
  return (
    <div
      className={`glowing-border ${className}`}
      style={{
        position: "relative",
        "--glow-color": glowColors[color],
      } as React.CSSProperties}
    >
      {children}
      <style jsx>{`
        .glowing-border {
          position: relative;
        }
        .glowing-border::before {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          background: linear-gradient(135deg, var(--glow-color), transparent 50%, var(--glow-color));
          opacity: 0;
          transition: opacity 0.3s ease;
          z-index: -1;
        }
        .glowing-border:hover::before {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
