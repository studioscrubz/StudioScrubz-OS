"use client";

import { useEffect, useMemo, useState } from "react";
import type { UserProfile } from "@/types/auth";
import {
  INTERNAL_EVENT_CATEGORIES,
  INTERNAL_EVENT_LEGACY_MODES,
  INTERNAL_EVENT_MODES,
  INTERNAL_EVENT_RSVP_STATUSES,
  INTERNAL_EVENT_VISIBILITIES,
  type InternalEventAccessLevel,
  type InternalEventAttendeeOption,
  type InternalEventInput,
  type InternalEventProspectOption,
  type InternalEventRsvpStatus,
  type InternalScheduleEvent,
} from "@/types/internalScheduleEvent";
import {
  cancelInternalScheduleEvent,
  createInternalScheduleEvent,
  getInternalEventFormOptions,
  updateInternalEventRsvp,
  updateInternalScheduleEvent,
} from "@/lib/services/internalScheduleEvents";

const input =
  "mt-2 h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm";
const primary =
  "rounded-lg bg-[#143d1a] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary =
  "rounded-lg border px-4 py-2.5 text-sm font-bold text-[#143d1a] disabled:opacity-50";
const timezones = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "UTC",
];

export function InternalEventDialog({
  event,
  access,
  profile,
  close,
  saved,
}: {
  event: InternalScheduleEvent | null;
  access: Exclude<InternalEventAccessLevel, "None">;
  profile: UserProfile;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const initial = useMemo(() => formState(event), [event]);
  const [form, setForm] = useState(initial);
  const [attendees, setAttendees] = useState<InternalEventAttendeeOption[]>([]);
  const [prospects, setProspects] = useState<InternalEventProspectOption[]>([]);
  const [clients, setClients] = useState<Awaited<ReturnType<typeof getInternalEventFormOptions>>["clients"]>([]);
  const [prospectSearch, setProspectSearch] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getInternalEventFormOptions()
      .then((options) => {
        if (active) {
          setAttendees(options.attendees);
          setProspects(options.prospects);
          setClients(options.clients);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, [access, profile]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const values = toInput(form);
      if (new Date(values.ends_at) <= new Date(values.starts_at))
        throw new Error("End time must be after start time.");
      const result = event
        ? await updateInternalScheduleEvent(event.id, values)
        : await createInternalScheduleEvent(values, profile);
      await saved(
        result.warning ??
          (result.google.meetUrl
            ? `${event ? "Internal event updated" : "Internal event created"} with Google Meet.`
            : event
              ? "Internal event updated."
              : "Internal event created."),
      );
    } catch (cause) {
      setError(message(cause));
      setSaving(false);
    }
  }

  const sales = access === "Sales";
  const filteredProspects = prospects.filter((prospect) =>
    prospect.company_name.toLowerCase().includes(prospectSearch.toLowerCase()),
  );
  const filteredClients = clients.filter((client) =>
    client.display_name.toLowerCase().includes(clientSearch.toLowerCase()),
  );
  const filteredAttendees = attendees.filter((attendee) =>
    attendee.display_name.toLowerCase().includes(attendeeSearch.toLowerCase()),
  );
  return (
    <Modal
      title={event ? "Edit Internal Event" : "Create Internal Event"}
      close={close}
    >
      <FormSection title="Event Details">
        <Field label="Title">
          <input
            required
            maxLength={200}
            className={input}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Category">
          <select
            className={input}
            value={form.category}
            onChange={(e) =>
              setForm({
                ...form,
                category: e.target.value as typeof form.category,
              })
            }
          >
            {INTERNAL_EVENT_CATEGORIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Meeting Mode">
          <select
            className={input}
            value={form.meetingMode}
            onChange={(e) =>
              setForm({
                ...form,
                meetingMode: e.target.value as typeof form.meetingMode,
              })
            }
          >
            {event && INTERNAL_EVENT_LEGACY_MODES.includes(event.meeting_mode as (typeof INTERNAL_EVENT_LEGACY_MODES)[number]) && (
              <option value={event.meeting_mode}>Legacy: {event.meeting_mode}</option>
            )}
            {INTERNAL_EVENT_MODES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Visibility">
          <select
            className={input}
            value={form.visibility}
            onChange={(e) =>
              setForm({
                ...form,
                visibility: e.target.value as typeof form.visibility,
              })
            }
          >
            {INTERNAL_EVENT_VISIBILITIES.map((value) => (
              <option
                key={value}
                disabled={sales && value === "Management only"}
              >
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <input
            type="datetime-local"
            className={input}
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
          />
        </Field>
        <Field label="End">
          <input
            type="datetime-local"
            className={input}
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
          />
        </Field>
        <Field label="Timezone">
          <select
            className={input}
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          >
            {[...new Set([form.timezone, ...timezones])].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
      </FormSection>
      <FormSection title="Related Records">
        <Field label="Search Prospects">
          <input className={input} value={prospectSearch} onChange={(e) => setProspectSearch(e.target.value)} placeholder="Search by company name" />
        </Field>
        <Field label="Existing Prospect (optional)">
          <select
            className={input}
            value={form.prospectId}
            onChange={(e) => setForm({ ...form, prospectId: e.target.value })}
          >
            <option value="">None</option>
            {filteredProspects.map((prospect) => (
              <option key={prospect.id} value={prospect.id}>
                {prospect.company_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search Clients">
          <input className={input} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search clients" />
        </Field>
        <Field label="Existing Client (optional)">
          <select className={input} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value="">None</option>
            {filteredClients.map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
          </select>
        </Field>
        <Field label="Vendor Name (optional)">
          <input
            maxLength={300}
            className={input}
            value={form.vendorName}
            onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
          />
        </Field>
      </FormSection>
      <FormSection title="Meeting Details">
        {form.meetingMode === "In Person" && <Field label="Physical Location (required)">
          <input required maxLength={500} className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>}
        {form.meetingMode === "Video Meeting" && <div className="sm:col-span-2 rounded-lg bg-emerald-50 p-3 text-sm text-[#143d1a]">A real Google Meet link will be created through the connected company Google Calendar. External linked records are not invited.</div>}
        {form.meetingMode === "Phone Call" && <>
          <Field label="Call Contact">
            <select className={input} value={form.callContactRef} onChange={(e) => {
              const value = e.target.value;
              const [kind, id] = value.split(":");
              const prospect = kind === "prospect" ? prospects.find((item) => item.id === id) : null;
              const client = kind === "client" ? clients.find((item) => item.id === id) : null;
              setForm({ ...form, callContactRef: value, callContactName: prospect?.company_name ?? client?.display_name ?? (kind === "vendor" ? form.vendorName : form.callContactName), callPhoneNumber: prospect?.business_phone ?? client?.phone ?? form.callPhoneNumber });
            }}>
              <option value="">Manual contact</option>
              {prospects.map((item) => <option key={`p-${item.id}`} value={`prospect:${item.id}`}>{item.company_name} (Prospect)</option>)}
              {clients.map((item) => <option key={`c-${item.id}`} value={`client:${item.id}`}>{item.display_name} (Client)</option>)}
              {form.vendorName && <option value="vendor:name">{form.vendorName} (Vendor)</option>}
            </select>
          </Field>
          <Field label="Call Contact Name (required)"><input required maxLength={300} className={input} value={form.callContactName} onChange={(e) => setForm({ ...form, callContactName: e.target.value })} /></Field>
          <Field label="Phone Number (required)"><input required type="tel" maxLength={50} className={input} value={form.callPhoneNumber} onChange={(e) => setForm({ ...form, callPhoneNumber: e.target.value })} /></Field>
          <Field label="Extension (optional)"><input maxLength={20} className={input} value={form.callPhoneExtension} onChange={(e) => setForm({ ...form, callPhoneExtension: e.target.value })} /></Field>
        </>}
        <Field label="Description">
          <textarea
            rows={4}
            className={`${input} h-auto py-3`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
      </FormSection>
      <fieldset className="mt-5 rounded-xl border p-4">
        <legend className="px-2 text-sm font-extrabold text-[#143d1a]">
          Authorized Attendees
        </legend>
        {loadingOptions ? (
          <p className="text-sm text-neutral-500">Loading attendees...</p>
        ) : (
          <div>
            <input className={`${input} mb-3`} value={attendeeSearch} onChange={(e) => setAttendeeSearch(e.target.value)} placeholder="Search authorized employees" aria-label="Search authorized attendees" />
            <div className="grid gap-2 sm:grid-cols-2">
            {filteredAttendees.map((attendee) => (
              <label
                key={attendee.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={form.attendeeIds.includes(attendee.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      attendeeIds: e.target.checked
                        ? [...form.attendeeIds, attendee.id]
                        : form.attendeeIds.filter((id) => id !== attendee.id),
                    })
                  }
                />
                {attendee.display_name}
              </label>
            ))}
            {!attendees.length && (
              <p className="text-sm text-neutral-500">
                No eligible attendees found.
              </p>
            )}
            </div>
          </div>
        )}
      </fieldset>
      {error && <Alert text={error} />}
      <button
        disabled={
          saving ||
          loadingOptions ||
          !form.title.trim() ||
          !form.start ||
          !form.end
          || (form.meetingMode === "In Person" && !form.location.trim())
          || (form.meetingMode === "Phone Call" && (!form.callContactName.trim() || !form.callPhoneNumber.trim()))
        }
        className={`${primary} mt-5`}
        onClick={() => void submit()}
      >
        {saving ? "Saving..." : event ? "Save Event" : "Create Event"}
      </button>
    </Modal>
  );
}

export function InternalEventDetails({
  event,
  access,
  profile,
  close,
  edit,
  saved,
}: {
  event: InternalScheduleEvent;
  access: Exclude<InternalEventAccessLevel, "None">;
  profile: UserProfile;
  close: () => void;
  edit: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = event.attendees.find(
    (attendee) => attendee.employee_id === profile.employee_id,
  );
  const canManage =
    profile.role === "Master Admin" || ((access === "Management" || access === "Sales") && event.organizer_user_id === profile.id);
  async function cancel() {
    if (!window.confirm("Cancel this internal event?")) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cancelInternalScheduleEvent(event.id);
      await saved(result.warning ?? "Internal event canceled.");
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }
  async function rsvp(status: InternalEventRsvpStatus) {
    if (!profile.employee_id) return;
    setBusy(true);
    setError(null);
    try {
      await updateInternalEventRsvp(event.id, profile.employee_id, status);
      await saved(`RSVP updated to ${status}.`);
    } catch (cause) {
      setError(message(cause));
      setBusy(false);
    }
  }
  return (
    <Modal title={event.title} close={close}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Detail
          label="When"
          value={`${formatDateTime(event.starts_at, event.timezone)} - ${formatDateTime(event.ends_at, event.timezone)} (${event.timezone})`}
        />
        <Detail
          label="Type"
          value={`${event.category} | ${event.meeting_mode}`}
        />
        <Detail label="Visibility" value={event.visibility} />
        <Detail label="Status" value={event.status} />
        {event.location && (
          <Detail label="Location" value={event.location} />
        )}{" "}
        {event.vendor_name && (
          <Detail label="Vendor" value={event.vendor_name} />
        )}{" "}
        {event.prospect && (
          <Detail label="Prospect" value={event.prospect.company_name} />
        )}{" "}
        {(event.google_sync?.google_meet_url || event.video_link) && (
          <div>
            <p className="text-xs font-bold uppercase text-neutral-500">
              Video
            </p>
            <a
              className="text-sm font-bold text-[#143d1a] underline"
              href={event.google_sync?.google_meet_url || event.video_link || undefined}
              target="_blank"
              rel="noreferrer"
            >
              Join meeting
            </a>
          </div>
        )}
        {event.meeting_mode === "Phone Call" && event.call_phone_number && (
          <div>
            <p className="text-xs font-bold uppercase text-neutral-500">Call</p>
            <p className="text-sm">{event.call_contact_name}</p>
            <a className="text-sm font-bold text-[#143d1a] underline" href={`tel:${event.call_phone_number}${event.call_phone_extension ? `,${event.call_phone_extension}` : ""}`}>{event.call_phone_number}{event.call_phone_extension ? ` ext. ${event.call_phone_extension}` : ""}</a>
          </div>
        )}
        {event.meeting_mode === "Video Meeting" && (
          <Detail label="Google Meet Status" value={event.google_sync?.sync_status ?? "Pending"} />
        )}
      </div>
      {event.description && (
        <section className="mt-5 rounded-xl bg-neutral-50 p-4">
          <h3 className="text-sm font-extrabold text-[#143d1a]">Description</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {event.description}
          </p>
        </section>
      )}
      <section className="mt-5">
        <h3 className="text-sm font-extrabold text-[#143d1a]">Attendees</h3>
        <div className="mt-2 space-y-1">
          {event.attendees.map((attendee) => (
            <p key={attendee.employee_id} className="text-sm">
              {employeeName(attendee.employee)}{" "}
              <span className="text-neutral-500">
                | {attendee.invitation_status}
              </span>
            </p>
          ))}
          {!event.attendees.length && (
            <p className="text-sm text-neutral-500">No attendees.</p>
          )}
        </div>
      </section>
      {mine && event.status === "Scheduled" && (
        <label className="mt-5 block text-sm font-bold">
          Your RSVP
          <select
            disabled={busy}
            className={input}
            value={mine.invitation_status}
            onChange={(e) =>
              void rsvp(e.target.value as InternalEventRsvpStatus)
            }
          >
            {INTERNAL_EVENT_RSVP_STATUSES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
      {error && <Alert text={error} />}{" "}
      {canManage && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            disabled={busy || event.status === "Canceled"}
            className={primary}
            onClick={edit}
          >
            Edit Event
          </button>
          <button
            disabled={busy || event.status === "Canceled"}
            className={secondary}
            onClick={() => void cancel()}
          >
            Cancel Event
          </button>
        </div>
      )}
    </Modal>
  );
}

type FormState = ReturnType<typeof formState>;
function formState(event: InternalScheduleEvent | null) {
  const timezone =
    event?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "America/Los_Angeles";
  const start = event
    ? dateTimeInput(event.starts_at, timezone)
    : defaultDateTime(1);
  const end = event
    ? dateTimeInput(event.ends_at, timezone)
    : defaultDateTime(2);
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    category: event?.category ?? ("Administrative" as const),
    meetingMode: event?.meeting_mode ?? ("In Person" as const),
    start,
    end,
    timezone,
    visibility: event?.visibility ?? ("Company-wide" as const),
    location: event?.location ?? "",
    prospectId: event?.prospect_id ?? "",
    clientId: event?.client_id ?? "",
    vendorName: event?.vendor_name ?? "",
    callContactRef: "",
    callContactName: event?.call_contact_name ?? "",
    callPhoneNumber: event?.call_phone_number ?? "",
    callPhoneExtension: event?.call_phone_extension ?? "",
    attendeeIds: event?.attendees.map((attendee) => attendee.employee_id) ?? [],
  };
}
function toInput(form: FormState): InternalEventInput {
  return {
    title: form.title.trim(),
    description: empty(form.description),
    category: form.category,
    meeting_mode: form.meetingMode,
    starts_at: zonedDateTimeToIso(form.start, form.timezone),
    ends_at: zonedDateTimeToIso(form.end, form.timezone),
    timezone: form.timezone,
    visibility: form.visibility,
    location: empty(form.location),
    prospect_id: form.prospectId || null,
    client_id: form.clientId || null,
    vendor_name: empty(form.vendorName),
    call_contact_name: form.meetingMode === "Phone Call" ? empty(form.callContactName) : null,
    call_phone_number: form.meetingMode === "Phone Call" ? empty(form.callPhoneNumber) : null,
    call_phone_extension: form.meetingMode === "Phone Call" ? empty(form.callPhoneExtension) : null,
    attendee_employee_ids: form.attendeeIds,
  };
}
function empty(value: string) {
  return value.trim() || null;
}
function defaultDateTime(hours: number) {
  const value = new Date(Date.now() + hours * 3600000);
  value.setMinutes(0, 0, 0);
  return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}T${two(value.getHours())}:00`;
}
function dateTimeInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((row) => row.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function zonedDateTimeToIso(value: string, timezone: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let result = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const rendered = dateTimeInput(result.toISOString(), timezone);
    const [renderedDate, renderedTime] = rendered.split("T");
    const [ry, rm, rd] = renderedDate.split("-").map(Number);
    const [rh, rmin] = renderedTime.split(":").map(Number);
    result = new Date(
      result.getTime() +
        Date.UTC(year, month - 1, day, hour, minute) -
        Date.UTC(ry, rm - 1, rd, rh, rmin),
    );
  }
  return result.toISOString();
}
function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function employeeName(
  employee: InternalScheduleEvent["attendees"][number]["employee"],
) {
  return (
    employee?.preferred_name?.trim() ||
    (employee
      ? `${employee.first_name} ${employee.last_name}`.trim()
      : "Unavailable employee")
  );
}
function two(value: number) {
  return String(value).padStart(2, "0");
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "Operation failed.";
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      {children}
    </label>
  );
}
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-5 rounded-xl border p-4 first:mt-0">
      <legend className="px-2 text-sm font-extrabold text-[#143d1a]">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase text-neutral-500">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
function Alert({ text }: { text: string }) {
  return (
    <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">
      {text}
    </p>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold text-[#143d1a]">{title}</h2>
          <button type="button" className={secondary} onClick={close}>
            Close
          </button>
        </header>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}
