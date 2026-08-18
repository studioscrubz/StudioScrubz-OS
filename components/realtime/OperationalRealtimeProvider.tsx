"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export const OPERATIONAL_TABLES = [
  "estimates", "walkthroughs", "proposals", "service_agreements", "jobs",
  "invoices", "attention_item_states", "client_communications", "service_occurrences",
] as const;
export type OperationalTable = (typeof OPERATIONAL_TABLES)[number];
type Revisions = Record<OperationalTable, number>;
const initial = Object.fromEntries(OPERATIONAL_TABLES.map((table) => [table, 0])) as Revisions;
const RealtimeContext = createContext<Revisions>(initial);

export function OperationalRealtimeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [revisions, setRevisions] = useState<Revisions>(initial);
  useEffect(() => {
    if (loading || !user) return;
    const client = getSupabaseClient();
    let channel = client.channel(`operational-${user.id}`);
    for (const table of OPERATIONAL_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        setRevisions((current) => ({ ...current, [table]: current[table] + 1 }));
      });
    }
    channel.subscribe();
    return () => { void client.removeChannel(channel); };
  }, [loading, user]);
  return <RealtimeContext.Provider value={revisions}>{children}</RealtimeContext.Provider>;
}

export function useOperationalRealtime(tables: readonly OperationalTable[], refresh: () => void | Promise<void>) {
  const revisions = useContext(RealtimeContext);
  const refreshRef = useRef(refresh);
  const mounted = useRef(false);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const signature = useMemo(() => tables.map((table) => revisions[table]).join(":"), [revisions, tables]);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const timer = window.setTimeout(() => { void refreshRef.current(); }, 150);
    return () => window.clearTimeout(timer);
  }, [signature]);
}
