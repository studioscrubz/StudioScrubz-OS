export const ATTENTION_SEVERITIES = ["Info", "Attention", "Urgent"] as const;
export const ATTENTION_CATEGORIES = ["Jobs", "Proposals", "Agreements", "Invoices", "Communications", "Time"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];
export type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number];
export type AttentionType = "Unscheduled Job" | "Job Needs Crew" | "Upcoming Job" | "Service Reminder Due" | "Proposal Awaiting Approval" | "Proposal Awaiting Client" | "Agreement Awaiting Signature" | "Agreement Accepted Not Active" | "Agreement Expiring" | "Invoice Due Soon" | "Overdue Invoice" | "Failed Client Communication" | "Open Time Entry";
export type AttentionState = "Snoozed" | "Dismissed";
export type AttentionView = "Active" | "Snoozed" | "Dismissed" | "All";
export type AttentionStateRecord = { id: string; user_id: string; attention_key: string; state: AttentionState; snoozed_until: string | null; dismissed_at: string | null; created_at: string; updated_at: string };
export type AttentionItem = {
  id: string; type: AttentionType; severity: AttentionSeverity; category: AttentionCategory;
  title: string; description: string; record_type: string; record_id: string;
  client_id: string | null; entity_label: string | null; due_date: string | null;
  scheduled_date: string | null; created_at: string; action_url: string; action_label: string;
  metadata: Record<string, string | number | boolean | null>;
  snoozable: boolean; dismissible: boolean; attention_state: AttentionStateRecord | null;
  communication_context: CommunicationComposerContext | null;
};
export type AttentionSummary = { urgent: number; attention: number; info: number; total: number; snoozed: number };
import type { CommunicationComposerContext } from "@/types/clientCommunication";
