import type { UpcomingClientService } from "@/types/clientCommunication";

export function selectUpcomingServicesForClient(services: UpcomingClientService[], clientId: string): UpcomingClientService[] {
  const wrongClient = services.find((service) => service.clientId !== clientId);
  if (wrongClient) throw new Error(`Upcoming service lookup returned a record for a different client (${wrongClient.clientId}).`);
  return [...services].sort(compareUpcomingServices);
}

export function normalizeUpcomingClientServices(value: unknown, clientId: string): UpcomingClientService[] {
  if (!Array.isArray(value)) throw new Error("Upcoming service lookup returned a malformed response instead of a list.");
  const services = value.map((row, index) => normalizeUpcomingClientService(row, index));
  return selectUpcomingServicesForClient(services, clientId);
}

export function compareUpcomingServices(left: UpcomingClientService, right: UpcomingClientService): number {
  return left.scheduledDate.localeCompare(right.scheduledDate)
    || (left.startTime ?? "99:99:99").localeCompare(right.startTime ?? "99:99:99")
    || left.sourceId.localeCompare(right.sourceId);
}

export function buildServiceReminderTemplate(service: UpcomingClientService, greeting: string) {
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${service.scheduledDate}T12:00:00`));
  const time = service.startTime ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${service.startTime}`)) : null;
  const scheduleText = time ? `${date} at ${time}` : date;
  return {
    subject: `Reminder: ${service.serviceName} — ${date}`,
    message: [
      `Hello ${greeting},`, "", `This is a reminder that your ${service.serviceName} service with StudioScrubz is scheduled for ${scheduleText}.`,
      ...(service.propertyAddress ? ["", "Service Location:", service.propertyAddress] : []),
      "", "If you have any questions or need to make changes, please contact StudioScrubz.", "", "Thank you,", "StudioScrubz",
    ].join("\n"),
  };
}

function normalizeUpcomingClientService(value: unknown, index: number): UpcomingClientService {
  if (!value || typeof value !== "object") throw contractError(index, "row is not an object");
  const row = value as Record<string, unknown>;
  const source = requiredString(row.source_type, index, "source_type");
  if (source !== "Job" && source !== "Service Occurrence") throw contractError(index, `source_type is ${JSON.stringify(source)}`);
  const scheduledDate = requiredString(row.scheduled_date, index, "scheduled_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) throw contractError(index, "scheduled_date is not YYYY-MM-DD");
  const startTime = nullableString(row.start_time, index, "start_time");
  if (startTime && !/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(startTime)) throw contractError(index, "start_time is malformed");
  return {
    source,
    sourceId: requiredString(row.source_id, index, "source_id"),
    clientId: requiredString(row.client_id, index, "client_id"),
    propertyId: nullableString(row.property_id, index, "property_id"),
    serviceName: nullableString(row.service_name, index, "service_name") || "Scheduled Service",
    scheduledDate,
    startTime,
    propertyAddress: nullableString(row.property_address, index, "property_address"),
  };
}

function requiredString(value: unknown, index: number, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw contractError(index, `${field} is missing`);
  return value.trim();
}

function nullableString(value: unknown, index: number, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw contractError(index, `${field} is neither a string nor null`);
  return value.trim() || null;
}

function contractError(index: number, detail: string): Error {
  return new Error(`Upcoming service lookup contract failed at row ${index + 1}: ${detail}.`);
}
