import type { Client, ClientStatus } from "@/types/client";

export const CLIENT_VIEWS = ["all", "leads", "active", "inactive"] as const;

export type ClientView = (typeof CLIENT_VIEWS)[number];

export function isClientView(value: string | null): value is ClientView {
  return CLIENT_VIEWS.includes(value as ClientView);
}

export function clientViewStatus(view: ClientView): ClientStatus | null {
  if (view === "leads") return "Lead";
  if (view === "active") return "Active";
  if (view === "inactive") return "Inactive";
  return null;
}

export function matchesClientView(client: Pick<Client, "status">, view: ClientView): boolean {
  const status = clientViewStatus(view);
  return status === null || client.status === status;
}

export function clientViewCounts(clients: Array<Pick<Client, "status">>) {
  return {
    all: clients.length,
    leads: clients.filter((client) => client.status === "Lead").length,
    active: clients.filter((client) => client.status === "Active").length,
    inactive: clients.filter((client) => client.status === "Inactive").length,
  } satisfies Record<ClientView, number>;
}
