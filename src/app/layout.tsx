import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ParticleBackground } from "@/components/common/ParticleBackground";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moss Agent",
  description: "Claude Code 与 Codex 本地协作调度平台",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ParticleBackground />
        {children}
      </body>
    </html>
  );
}
