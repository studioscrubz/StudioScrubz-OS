import type { UpcomingClientService } from "@/types/clientCommunication";

export function selectUpcomingServicesForClient(services: UpcomingClientService[], clientId: string): UpcomingClientService[] {
  return services.filter((service) => service.clientId === clientId).sort(compareUpcomingServices);
}

export function compareUpcomingServices(left: UpcomingClientService, right: UpcomingClientService): number {
  return left.scheduledDate.localeCompare(right.scheduledDate)
    || (left.startTime ?? "99:99:99").localeCompare(right.startTime ?? "99:99:99")
    || left.sourceId.localeCompare(right.sourceId);
}
