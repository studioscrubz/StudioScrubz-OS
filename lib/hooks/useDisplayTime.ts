"use client";
import { useEffect, useState } from "react";

/** A display clock only; never requests device location or changes job time. */
export function useDisplayTime(intervalMs: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, intervalMs);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [intervalMs]);
  return now;
}
