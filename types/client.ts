export const CLIENT_TYPES = ["Residential", "Commercial", "Contractor"] as const;
export const CLIENT_STATUSES = ["Lead", "Active", "Inactive"] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export type Client = {
  id: string;
  client_type: ClientType;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  status: ClientStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ClientInput = {
  client_type: ClientType;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  status: ClientStatus;
  notes: string | null;
};
