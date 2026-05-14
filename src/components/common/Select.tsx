"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="selectWrap">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}
