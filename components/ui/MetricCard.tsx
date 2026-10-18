import type { ReactNode } from "react";
import type { SemanticTone } from "@/lib/ui/status";

const toneStyles: Record<SemanticTone, string> = { brand: "border-[var(--border)]", success: "border-[var(--status-success-border)]", info: "border-[var(--status-info-border)]", warning: "border-[var(--status-warning-border)]", danger: "border-[var(--status-danger-border)]", neutral: "border-[var(--border)]" };

export function MetricCard({ label, value = "—", hint, tone = "brand", className = "" }: { label: string; value?: ReactNode; hint?: ReactNode; tone?: SemanticTone; className?: string }) {
  return <article className={`rounded-2xl border bg-[var(--surface)] p-5 shadow-[0_8px_25px_rgba(20,61,26,0.045)] ${toneStyles[tone]} ${className}`}><div className="mb-6 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{label}</p><span aria-hidden className="size-2 rounded-full bg-[var(--brand-gold)]" /></div><p aria-label={value === "—" ? `${label}: no data yet` : undefined} className="text-3xl font-extrabold text-[var(--brand-green)]">{value}</p>{hint && <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p>}</article>;
}
