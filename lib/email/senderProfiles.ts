export const EMAIL_SENDER_PROFILES = {
  general: { from: "StudioScrubz <info@studioscrubz.com>", replyTo: "info@studioscrubz.com" },
  estimate: { from: "StudioScrubz Estimates <estimates@studioscrubz.com>", replyTo: "estimates@studioscrubz.com" },
  proposal: { from: "StudioScrubz Estimates <estimates@studioscrubz.com>", replyTo: "estimates@studioscrubz.com" },
  serviceAgreement: { from: "StudioScrubz <info@studioscrubz.com>", replyTo: "info@studioscrubz.com" },
  billing: { from: "StudioScrubz Billing <billing@studioscrubz.com>", replyTo: "billing@studioscrubz.com" },
  scheduling: { from: "StudioScrubz Scheduling <scheduling@studioscrubz.com>", replyTo: "scheduling@studioscrubz.com" },
  postConstructionDeposit: { from: "StudioScrubz Billing <billing@studioscrubz.com>", replyTo: "billing@studioscrubz.com" },
  vendor: { from: "StudioScrubz Vendors <vendors@studioscrubz.com>", replyTo: "vendors@studioscrubz.com" },
  careers: { from: "StudioScrubz Careers <careers@studioscrubz.com>", replyTo: "careers@studioscrubz.com" },
  marketing: { from: "StudioScrubz <donotreply@studioscrubz.com>", replyTo: "info@studioscrubz.com" },
  systemNotification: { from: "StudioScrubz Notifications <notifications@studioscrubz.com>", replyTo: "donotreply@studioscrubz.com" },
  noReply: { from: "StudioScrubz <donotreply@studioscrubz.com>", replyTo: null },
  prospectOutreach: { from: "StudioScrubz <info@studioscrubz.com>", replyTo: "info@studioscrubz.com" },
} as const;

export type EmailSenderProfileKey = keyof typeof EMAIL_SENDER_PROFILES;
export type EmailSenderIdentity = { from: string; replyTo: string | null };

export function resolveEmailSenderProfile(key: EmailSenderProfileKey): EmailSenderIdentity {
  return EMAIL_SENDER_PROFILES[key];
}
