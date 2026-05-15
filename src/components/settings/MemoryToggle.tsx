"use client";

interface MemoryToggleProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}

export function MemoryToggle({ label, description, checked, disabled, onToggle }: MemoryToggleProps) {
  return (
    <div className="memoryToggle">
      <div className="memoryToggleBody">
        <span className="memoryToggleLabel">{label}</span>
        <span className="memoryToggleDesc">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className="toggleSwitch"
        onClick={() => onToggle(!checked)}
      />
    </div>
  );
}
