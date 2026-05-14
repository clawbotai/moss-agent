"use client";

export function HealthPill({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className={ok ? "health ok" : "health warn"} title={text}>
      <span />
      {label}
    </div>
  );
}
