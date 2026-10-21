"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

export const OPERATIONAL_TABLES = [
  "internal_schedule_events", "internal_schedule_event_attendees",
  "porter_notification_events",
  "property_service_routes", "property_service_route_stops",
  "property_service_visits", "property_service_visit_photos", "property_service_visit_issues",
  "estimates", "walkthroughs", "proposals", "service_agreements", "jobs",
  "invoices", "attention_item_states", "client_communications", "service_occurrences",
  "job_labor_threshold_events",
  "invoice_job_photos", "invoice_job_lines",
  "service_agreement_documents",
  "payments", "expenses", "time_entries", "employee_work_sessions", "clients", "properties", "crews", "employees",
  "services", "service_addons", "service_addon_links", "service_price_tiers",
  "recurring_pricing_rules",
  "conversations", "conversation_members", "messages", "message_read_states", "announcement_acknowledgments",
] as const;
export type OperationalTable = (typeof OPERATIONAL_TABLES)[number];
type Revisions = Record<OperationalTable, number>;
const initial = Object.fromEntries(OPERATIONAL_TABLES.map((table) => [table, 0])) as Revisions;
type RealtimeContextValue = { revisions: Revisions; watch: (tables: readonly OperationalTable[]) => () => void };
const RealtimeContext = createContext<RealtimeContextValue>({ revisions: initial, watch: () => () => undefined });

export function OperationalRealtimeProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [revisions, setRevisions] = useState<Revisions>(initial);
  const [watched, setWatched] = useState<Partial<Record<OperationalTable, number>>>({});
  const watch = useCallback((tables: readonly OperationalTable[]) => {
    const unique = [...new Set(tables)];
    setWatched((current) => { const next = { ...current }; for (const table of unique) next[table] = (next[table] ?? 0) + 1; return next; });
    return () => setWatched((current) => { const next = { ...current }; for (const table of unique) { const count = (next[table] ?? 0) - 1; if (count > 0) next[table] = count; else delete next[table]; } return next; });
  }, []);
  const activeTables = useMemo(() => OPERATIONAL_TABLES.filter((table) => (watched[table] ?? 0) > 0), [watched]);
  const activeSignature = activeTables.join(":");
  useEffect(() => {
    if (loading || !userId || activeTables.length === 0) return;
    const client = getSupabaseClient();
    let channel = client.channel(`operational-${userId}-${activeSignature}`);
    for (const table of activeTables) {
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
  }, [activeSignature, activeTables, loading, userId]);
  const value = useMemo(() => ({ revisions, watch }), [revisions, watch]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useOperationalRealtime(tables: readonly OperationalTable[], refresh: () => void | Promise<void>) {
  const { revisions, watch } = useContext(RealtimeContext);
  const refreshRef = useRef(refresh);
  const mounted = useRef(false);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const tableSignature = tables.join(":");
  const signature = tables.map((table) => revisions[table]).join(":");
  useEffect(() => watch(tableSignature ? tableSignature.split(":") as OperationalTable[] : []), [tableSignature, watch]);
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
