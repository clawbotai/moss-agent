"use client";

import { useRef, type RefObject } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  wrapperClassName?: string;
  triggerRef?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export function Popover({ open, onClose, className = "", wrapperClassName = "", triggerRef, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, triggerRef);

  if (!open) return null;

  return (
    <div className={`popover ${wrapperClassName}`}>
      <div ref={ref} className={`popoverContent ${className}`}>
        {children}
      </div>
    </div>
  );
}
