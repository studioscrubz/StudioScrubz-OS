import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "./crypto";

type GoogleError = Error & { status?: number };
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type GoogleEvent = {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
};
type InternalEventSync = {
  connection_id?: string | null;
  calendar_id?: string | null;
  google_event_id?: string | null;
};
type InternalEventRow = {
  id: string;
  title: string;
  description: string | null;
  meeting_mode: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string | null;
  status: "Scheduled" | "Canceled";
};

function googleEventId(eventId: string) {
  return `ssinternal${eventId.replaceAll("-", "").toLowerCase()}`;
}

function conferenceRequestId(eventId: string) {
  return `ssinternal-${eventId}`;
}

async function accessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    if (body.error === "invalid_grant")
      throw new Error(
        "Google Calendar authorization has expired. Reconnect Google Calendar before creating a video meeting.",
      );
    throw new Error(body.error_description || "Google authorization failed.");
  }
  return body.access_token as string;
}

async function google(token: string, path: string, init: RequestInit) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw Object.assign(
      new Error(body?.error?.message || "Google Calendar request failed."),
      { status: response.status },
    );
  }
  return body;
}

function eventPayload(event: InternalEventRow, requestId: string) {
  return {
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: { dateTime: event.starts_at, timeZone: event.timezone },
    end: { dateTime: event.ends_at, timeZone: event.timezone },
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
}

function meetUrl(remote: unknown): string | null {
  if (!remote || typeof remote !== "object") return null;
  const event = remote as GoogleEvent;
  return (
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find(
      (entry: { entryPointType?: string }) => entry.entryPointType === "video",
    )?.uri ??
    null
  );
}

export async function syncInternalScheduleEventGoogle(eventId: string) {
  const db = createSupabaseAdminClient();
  const [{ data: event, error: eventError }, { data: sync, error: syncError }] =
    await Promise.all([
      db.from("internal_schedule_events").select("id,title,description,meeting_mode,starts_at,ends_at,timezone,location,status").eq("id", eventId).single(),
      db.from("internal_schedule_event_google_syncs").select("*").eq("event_id", eventId).maybeSingle(),
    ]);
  if (eventError || !event) throw eventError ?? new Error("Internal event not found.");
  if (syncError) throw syncError;

  const now = new Date().toISOString();
  const notVideo = event.meeting_mode !== "Video Meeting";
  if (notVideo && !sync?.google_event_id) {
    await db.from("internal_schedule_event_google_syncs").upsert({
      event_id: eventId,
      sync_status: event.status === "Canceled" ? "Canceled" : "Not Required",
      google_meet_url: null,
      last_sync_error: null,
      last_attempted_at: now,
      last_synced_at: now,
      updated_at: now,
    });
    return { status: "Not Required" as const, meetUrl: null };
  }

  const { data: connection, error: connectionError } = await db
    .from("google_calendar_connections")
    .select("id,calendar_id,encrypted_refresh_token")
    .limit(1)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection?.calendar_id || !connection.encrypted_refresh_token) {
    const error = new Error(
      "Google Calendar is disconnected. Reconnect it before syncing this event.",
    );
    await recordFailure(db, eventId, sync, error, now);
    throw error;
  }

  let remoteEventId = sync?.google_event_id ?? googleEventId(eventId);
  const base = `/calendars/${encodeURIComponent(connection.calendar_id)}/events`;
  try {
    const token = await accessToken(decryptToken(connection.encrypted_refresh_token));
    if (event.status === "Canceled" || notVideo) {
      try {
        await google(token, `${base}/${remoteEventId}?sendUpdates=none`, { method: "DELETE" });
      } catch (cause) {
        if ((cause as GoogleError).status !== 404) throw cause;
      }
      const status = event.status === "Canceled" ? "Canceled" : "Not Required";
      await db.from("internal_schedule_event_google_syncs").upsert({
        event_id: eventId,
        connection_id: connection.id,
        calendar_id: connection.calendar_id,
        google_event_id: remoteEventId,
        google_meet_url: null,
        sync_status: status,
        last_sync_error: null,
        last_attempted_at: now,
        last_synced_at: now,
        updated_at: now,
      });
      return { status, meetUrl: null };
    }

    const payload = eventPayload(event, conferenceRequestId(eventId));
    let remote: unknown;
    if (sync?.google_event_id) {
      try {
        remote = await google(
          token,
          `${base}/${remoteEventId}?conferenceDataVersion=1&sendUpdates=none`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
      } catch (cause) {
        if ((cause as GoogleError).status !== 404) throw cause;
        remoteEventId = `${remoteEventId}r`;
      }
    }
    if (!remote) {
      try {
        remote = await google(
          token,
          `${base}?conferenceDataVersion=1&sendUpdates=none`,
          { method: "POST", body: JSON.stringify({ ...payload, id: remoteEventId }) },
        );
      } catch (cause) {
        if ((cause as GoogleError).status !== 409) throw cause;
        remote = await google(
          token,
          `${base}/${remoteEventId}?conferenceDataVersion=1&sendUpdates=none`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
      }
    }
    const url = meetUrl(remote);
    if (!url) throw new Error("Google Calendar did not return a Google Meet link.");
    await db.from("internal_schedule_event_google_syncs").upsert({
      event_id: eventId,
      connection_id: connection.id,
      calendar_id: connection.calendar_id,
      google_event_id: remoteEventId,
      google_meet_url: url,
      sync_status: "Synced",
      last_sync_error: null,
      last_attempted_at: now,
      last_synced_at: now,
      updated_at: now,
    });
    return { status: "Synced" as const, meetUrl: url };
  } catch (cause) {
    await recordFailure(db, eventId, { ...sync, google_event_id: remoteEventId }, cause, now, connection);
    throw cause;
  }
}

async function recordFailure(
  db: AdminClient,
  eventId: string,
  sync: InternalEventSync | null,
  cause: unknown,
  now: string,
  connection?: { id: string; calendar_id: string },
) {
  await db.from("internal_schedule_event_google_syncs").upsert({
    event_id: eventId,
    connection_id: connection?.id ?? sync?.connection_id ?? null,
    calendar_id: connection?.calendar_id ?? sync?.calendar_id ?? null,
    google_event_id: sync?.google_event_id ?? null,
    google_meet_url: null,
    sync_status: "Failed",
    last_sync_error: cause instanceof Error ? cause.message : "Google Calendar sync failed.",
    last_attempted_at: now,
    updated_at: now,
  });
}

export const internalEventGoogleIds = { googleEventId, conferenceRequestId };
