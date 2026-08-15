export const COMMUNICATION_TYPES = ["Estimate", "Proposal", "Service Agreement", "Service Reminder", "Invoice", "Payment Reminder", "General", "System"] as const;
export const COMMUNICATION_CHANNELS = ["Email", "SMS", "Phone", "In App", "Other"] as const;
export const COMMUNICATION_DIRECTIONS = ["Outbound", "Inbound", "System"] as const;
export const COMMUNICATION_STATUSES = ["Prepared", "Sent", "Delivered", "Opened", "Failed", "Cancelled", "Archived"] as const;

export type CommunicationType = (typeof COMMUNICATION_TYPES)[number] | (string & {});
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];
export type CommunicationMetadataValue = string | number | boolean | null | CommunicationMetadataValue[] | { [key: string]: CommunicationMetadataValue };
export type CommunicationMetadata = Record<string, CommunicationMetadataValue>;

export type ClientCommunication = {
  id: string;
  communication_number: string;
  client_id: string | null;
  property_id: string | null;
  estimate_id: string | null;
  proposal_id: string | null;
  agreement_id: string | null;
  invoice_id: string | null;
  communication_type: CommunicationType;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject: string | null;
  message_body: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  status: CommunicationStatus;
  provider: string | null;
  provider_message_id: string | null;
  failure_reason: string | null;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  metadata: CommunicationMetadata;
  event_key: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ClientCommunicationInput = {
  client_id?: string | null;
  property_id?: string | null;
  estimate_id?: string | null;
  proposal_id?: string | null;
  agreement_id?: string | null;
  invoice_id?: string | null;
  communication_type: CommunicationType;
  channel: CommunicationChannel;
  direction?: CommunicationDirection;
  subject?: string | null;
  message_body?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  sent_at?: string | null;
  status?: CommunicationStatus;
  provider?: string | null;
  provider_message_id?: string | null;
  failure_reason?: string | null;
  sent_by_name?: string | null;
  metadata?: CommunicationMetadata;
  event_key?: string | null;
};

export type CommunicationRecordFilter = { estimateId?: string; proposalId?: string; agreementId?: string; invoiceId?: string };

export type UpcomingClientService = {
  source: "Job" | "Service Occurrence";
  sourceId: string;
  clientId: string;
  propertyId: string | null;
  serviceName: string;
  scheduledDate: string;
  startTime: string | null;
  propertyAddress: string | null;
};

export type CommunicationComposerContext = {
  clientId: string | null; propertyId?: string | null; estimateId?: string | null; proposalId?: string | null;
  agreementId?: string | null; invoiceId?: string | null; jobId?: string | null; serviceOccurrenceId?: string | null;
  communicationType: CommunicationType; channel: CommunicationChannel;
  clientName: string; recipientEmail: string | null; recipientPhone: string | null;
  subject: string; messageBody: string; handoffSuffix?: string | null;
  sourceType: string; sourceId: string; metadata?: CommunicationMetadata;
};
