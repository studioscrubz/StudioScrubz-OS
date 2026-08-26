"use client";

import { useCallback, useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { getMyWorkSession, startMyWork, stopMyWork } from "@/lib/services/workSessions";
import type { EmployeeWorkSession } from "@/types/workSession";

export function WorkClockControl({ employeeId }: { employeeId: string | null }) {
  const [session, setSession] = useState<EmployeeWorkSession | null>(null);
  const [loading, setLoading] = useState(Boolean(employeeId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useCurrentTime(Boolean(session));
  const load = useCallback(async () => {
    if (!employeeId) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      setSession(await getMyWorkSession());
      setError(null);
    } catch (cause) {
      console.error("Work session load failed", cause);
      setError(message(cause, "Your work status could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);
  useOperationalRealtime(["employee_work_sessions"], load);

  if (!employeeId) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (session) {
        await stopMyWork();
        setSession(null);
      } else {
        setSession(await startMyWork());
      }
    } catch (cause) {
      console.error("Work clock action failed", cause);
      setError(message(cause, session ? "Clock-out failed. Please try again." : "Start failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3">
      {error && <p role="alert" className="mb-2 rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-100">{error}</p>}
      <button
        type="button"
        disabled={loading || busy}
        aria-pressed={Boolean(session)}
        onClick={() => void toggle()}
        className={`flex min-h-12 w-full items-center justify-center rounded-lg border px-3 py-3 text-sm font-extrabold transition disabled:cursor-wait disabled:opacity-60 ${session ? "border-emerald-300/70 bg-emerald-400/20 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,.18)] hover:bg-emerald-400/30" : "border-white/15 bg-white/[.06] text-white/75 hover:bg-white/10 hover:text-white"}`}
      >
        {loading ? "CHECKING WORK STATUS…" : busy ? "SAVING…" : session ? `● ACTIVE  ${elapsed(now - Date.parse(session.clock_in))}` : "START MY WORK"}
      </button>
    </div>
  );
}

function useCurrentTime(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [ticking]);
  return now;
}

function elapsed(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
