"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export const OPERATIONAL_TABLES = [
  "estimates", "walkthroughs", "proposals", "service_agreements", "jobs",
  "invoices", "attention_item_states", "client_communications", "service_occurrences",
  "invoice_job_photos",
  "service_agreement_documents",
  "payments", "expenses", "time_entries", "employee_work_sessions", "clients", "properties", "crews", "employees",
  "services", "service_addons", "service_addon_links", "service_price_tiers",
  "recurring_pricing_rules",
] as const;
export type OperationalTable = (typeof OPERATIONAL_TABLES)[number];
type Revisions = Record<OperationalTable, number>;
const initial = Object.fromEntries(OPERATIONAL_TABLES.map((table) => [table, 0])) as Revisions;
const RealtimeContext = createContext<Revisions>(initial);

export function OperationalRealtimeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [revisions, setRevisions] = useState<Revisions>(initial);
  useEffect(() => {
    if (loading || !userId) return;
    const client = getSupabaseClient();
    let channel = client.channel(`operational-${userId}`);
    for (const table of OPERATIONAL_TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        setRevisions((current) => ({ ...current, [table]: current[table] + 1 }));
      });
    }
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(`Operational realtime channel status: ${status}`);
      }
    });
    return () => { void client.removeChannel(channel); };
  }, [loading, userId]);
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
    const timer = window.setTimeout(() => {
      try {
        void Promise.resolve(refreshRef.current()).catch((error: unknown) => {
          console.error("Operational realtime refresh failed", error);
        });
      } catch (error) {
        console.error("Operational realtime refresh failed", error);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [signature]);
}
