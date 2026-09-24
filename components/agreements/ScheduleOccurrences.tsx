"use client";

import { useEffect, useState } from "react";
import { useOperationalRealtime } from "@/components/realtime/OperationalRealtimeProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { hasPermission } from "@/lib/auth/permissions";
import { formatTime12Hour } from "@/lib/formatTime";
import {
  createJobFromOccurrence,
  getUpcomingOccurrences,
} from "@/lib/services/serviceOccurrences";
import type { ServiceOccurrenceWithRelations } from "@/types/serviceOccurrence";

export function ScheduleOccurrences() {
  const { profile } = useAuth();
  const canCreateJobs = hasPermission(profile, "jobs.create");
  const [rows, setRows] = useState<ServiceOccurrenceWithRelations[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    if (!canCreateJobs) return;
    try {
      const records = await getUpcomingOccurrences(day(), add(day(), 60));

      setRows(
        records.filter(
          (row) =>
            row.agreement.status === "Active" &&
            !row.job_id &&
            !["Skipped", "Cancelled"].includes(row.status)
        )
      );

      setLoadError(null);
    } catch (cause: unknown) {
      console.error("Recurring services failed to load", cause);
      setLoadError(message(cause));
    }
  }

  useOperationalRealtime(
    ["service_occurrences", "service_agreements", "jobs"],
    load
  );

  useEffect(() => {
    if (!canCreateJobs) return;
    let active = true;

    void getUpcomingOccurrences(day(), add(day(), 60))
      .then((records) => {
        if (active) {
          setLoadError(null);
          setRows(
            records.filter(
              (row) =>
                row.agreement.status === "Active" &&
                !row.job_id &&
                !["Skipped", "Cancelled"].includes(row.status)
            )
          );
        }
      })
      .catch((cause: unknown) => {
        console.error("Recurring services failed to load", cause);
        if (active) setLoadError(message(cause));
      });

    return () => {
      active = false;
    };
  }, [canCreateJobs]);

  async function create(id: string) {
    setActionError(null);

    try {
      await createJobFromOccurrence(id);

      setRows((current) =>
        current.filter((row) => row.id !== id)
      );
    } catch (cause: unknown) {
      console.error("Recurring service Job creation failed", cause);
      setActionError(message(cause));
    }
  }

  if (!canCreateJobs) return null;

  return (
    <section className="mt-6 rounded-2xl border border-dashed bg-white p-5">
      <h2 className="font-extrabold text-[#143d1a]">
        Upcoming Recurring Services
      </h2>

      {loadError && (
        <p className="text-sm text-red-700">
          Recurring services could not be loaded: {loadError}
        </p>
      )}

      {actionError && (
        <p className="text-sm text-red-700">
          {actionError}
        </p>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const clientName =
            row.agreement.client?.company_name ||
            [
              row.agreement.client?.first_name,
              row.agreement.client?.last_name,
            ]
              .filter(Boolean)
              .join(" ") ||
            "Client not listed";

          return (
            <article
              className="rounded-xl bg-neutral-50 p-4"
              key={row.id}
            >
              <b>
                {row.scheduled_date} ·{" "}
                {formatTime12Hour(row.scheduled_start_time)}
              </b>

              <p>{row.agreement.service_name}</p>

              <p className="text-sm font-semibold text-neutral-700">
                {clientName}
              </p>

              <p className="text-sm text-neutral-500">
                {row.agreement.agreement_number}
              </p>

              <div className="mt-2 flex gap-2">
                {canCreateJobs && (
                  <button
                    className="rounded bg-[#143d1a] px-3 py-2 text-xs font-bold text-white"
                    onClick={() => void create(row.id)}
                  >
                    Create Job
                  </button>
                )}

                <a
                  className="rounded border px-3 py-2 text-xs font-bold"
                  href="/agreements"
                >
                  View Agreement
                </a>
              </div>
            </article>
          );
        })}
      </div>

      {!rows.length && !loadError && (
        <p className="mt-3 text-sm text-neutral-500">
          No recurring occurrences are awaiting Jobs.
        </p>
      )}
    </section>
  );
}

function message(cause: unknown) {
  return cause instanceof Error && cause.message
    ? cause.message
    : "The request failed. Please try again.";
}

function day() {
  return new Date().toISOString().slice(0, 10);
}

function add(value: string, count: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + count);
  return date.toISOString().slice(0, 10);
}
