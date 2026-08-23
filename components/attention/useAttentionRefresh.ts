"use client";

import { useEffect, useRef } from "react";
import { ATTENTION_REALTIME_TABLES } from "@/lib/services/attention";
import { ATTENTION_REFRESH_EVENT } from "@/lib/attentionEvents";
import { useOperationalRealtime, type OperationalTable } from "@/components/realtime/OperationalRealtimeProvider";

export function useAttentionRefresh(refresh: () => void | Promise<void>, extraTables: readonly OperationalTable[] = []) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useOperationalRealtime([...ATTENTION_REALTIME_TABLES, ...extraTables], refresh);
  useEffect(() => {
    const handleRefresh = () => {
      void Promise.resolve(refreshRef.current()).catch((error: unknown) => console.error("Requested Attention refresh failed", error));
    };
    window.addEventListener(ATTENTION_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(ATTENTION_REFRESH_EVENT, handleRefresh);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void Promise.resolve(refreshRef.current()).catch((error: unknown) => console.error("Timed Attention refresh failed", error));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
}
