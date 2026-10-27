"use client";

import { useState, type ReactNode } from "react";

/** Contents stay mounted when collapsed, preserving draft inputs and pending uploads. */
export function CompactJobSection({ title, subtitle, children, actionLabel, id, open, onOpenChange }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actionLabel?: string;
  id?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <details id={id} open={open ?? expanded} onToggle={event => {
    setExpanded(event.currentTarget.open);
    onOpenChange?.(event.currentTarget.open);
  }} className="group min-w-0 rounded-lg border border-[#143d1a]/15 bg-white">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-[#143d1a] marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#143d1a] [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 break-words"><strong>{title}</strong>{subtitle && <span className="ml-2 text-xs font-normal text-neutral-600">{subtitle}</span>}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs"><span>{actionLabel}</span><span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span></span>
    </summary>
    <div className="min-w-0 border-t border-[#143d1a]/10 p-3 [&_input]:max-w-full [&_select]:max-w-full [&_textarea]:max-w-full">{children}</div>
  </details>;
}
