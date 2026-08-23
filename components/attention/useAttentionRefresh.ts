"use client";

import { useEffect, useRef } from "react";
import { ATTENTION_REALTIME_TABLES } from "@/lib/services/attention";
import { useOperationalRealtime, type OperationalTable } from "@/components/realtime/OperationalRealtimeProvider";

export function useAttentionRefresh(refresh: () => void | Promise<void>, extraTables: readonly OperationalTable[] = []) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useOperationalRealtime([...ATTENTION_REALTIME_TABLES, ...extraTables], refresh);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void Promise.resolve(refreshRef.current()).catch((error: unknown) => console.error("Timed Attention refresh failed", error));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
}
