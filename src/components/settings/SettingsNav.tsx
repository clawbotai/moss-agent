"use client";

import { Brain, Settings } from "lucide-react";

interface SettingsNavProps {
  activeModule: "memory" | "general";
  onModuleChange: (module: "memory" | "general") => void;
}

const modules = [
  { id: "general" as const, label: "通用", icon: Settings },
  { id: "memory" as const, label: "记忆", icon: Brain },
];

export function SettingsNav({ activeModule, onModuleChange }: SettingsNavProps) {
  return (
    <nav className="settingsNav">
      {modules.map((mod) => (
        <button
          key={mod.id}
          type="button"
          className={`settingsNavItem ${activeModule === mod.id ? "active" : ""}`}
          onClick={() => onModuleChange(mod.id)}
        >
          <mod.icon size={16} />
          <span>{mod.label}</span>
        </button>
      ))}
    </nav>
  );
}
