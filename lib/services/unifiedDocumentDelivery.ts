import { openDeviceSmsApp, normalizeSmsPhoneNumber } from "@/lib/deviceSms";
import {
  markCommunicationFailed,
  recordAgreementSmsPrepared,
  recordEstimateSmsPrepared,
  recordInvoiceSmsPrepared,
  recordProposalSmsPrepared,
} from "@/lib/services/clientCommunications";
import { sendTransactionalCustomerEmail, type TransactionalDocumentType } from "@/lib/services/transactionalEmails";

type DocumentDeliveryInput = {
  documentType: TransactionalDocumentType;
  documentId: string;
  documentNumber: string;
  clientId: string | null;
  propertyId: string | null;
  email: string | null | undefined;
  phone: string | null | undefined;
  subject: string;
  messageBody: string;
  publicUrl: string;
  publicLinkLabel: string;
  prepare: (primaryChannel: "Email" | "Text", primaryRecipient: string) => Promise<void>;
};

export type UnifiedDeliveryResult = {
  email: "Sent" | "Failed" | "Not available";
  sms: "Message opened" | "Unable to open" | "Not available";
  message: string;
};

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export async function deliverDocument(input: DocumentDeliveryInput): Promise<UnifiedDeliveryResult> {
  const rawEmail = input.email?.trim().toLowerCase() || null;
  const email = rawEmail && EMAIL_PATTERN.test(rawEmail) ? rawEmail : null;
  const phone = input.phone ? normalizeSmsPhoneNumber(input.phone) : null;
  if (!rawEmail && !phone) throw new Error("Customer does not have an email address or phone number on file.");
  if (rawEmail && !email && !phone) throw new Error("The customer email address on file is invalid, and no usable phone number is available.");

  const requestId = crypto.randomUUID();
  await input.prepare(email ? "Email" : "Text", email ?? phone!);

  let emailStatus: UnifiedDeliveryResult["email"] = rawEmail ? "Failed" : "Not available";
  if (email) {
    try {
      await sendTransactionalCustomerEmail({
        documentType: input.documentType,
        documentId: input.documentId,
        recipientEmail: email,
        subject: input.subject,
        messageBody: input.messageBody,
        requestId,
      });
      emailStatus = "Sent";
    } catch (cause) {
      console.error(`${input.documentType} email delivery failed`, cause);
    }
  }

  let smsStatus: UnifiedDeliveryResult["sms"] = phone ? "Unable to open" : "Not available";
  if (phone) {
    const outgoing = `${input.messageBody}\n\n${input.publicLinkLabel}:\n${input.publicUrl}`;
    let communicationId: string | null = null;
    try {
      const communication = await smsRecorder(input.documentType)({
        id: input.documentId,
        number: input.documentNumber,
        clientId: input.clientId,
        propertyId: input.propertyId,
        recipientPhone: phone,
        subject: input.subject,
        messageBody: outgoing,
        requestId,
      });
      communicationId = communication.id;
    } catch (cause) {
      console.error(`${input.documentType} device SMS history could not be prepared`, cause);
    }
    try {
      openDeviceSmsApp(phone, outgoing);
      smsStatus = "Message opened";
    } catch (cause) {
      console.error(`${input.documentType} device SMS handoff failed`, cause);
      if (communicationId) await markCommunicationFailed(communicationId, "The device could not open its SMS composer.");
    }
  }

  const message = deliveryMessage(emailStatus, smsStatus);
  if (emailStatus !== "Sent" && smsStatus !== "Message opened") throw new Error(message);
  return { email: emailStatus, sms: smsStatus, message };
}

function smsRecorder(type: TransactionalDocumentType) {
  if (type === "Estimate") return recordEstimateSmsPrepared;
  if (type === "Proposal") return recordProposalSmsPrepared;
  if (type === "Service Agreement") return recordAgreementSmsPrepared;
  return recordInvoiceSmsPrepared;
}

function deliveryMessage(email: UnifiedDeliveryResult["email"], sms: UnifiedDeliveryResult["sms"]) {
  if (email === "Sent" && sms === "Message opened") return "Email sent. Text message opened on your device.";
  if (email === "Sent" && sms === "Unable to open") return "Email sent. Text message could not be opened on this device.";
  if (email === "Failed" && sms === "Message opened") return "Email could not be sent. Text message opened on your device.";
  if (email === "Failed" && sms === "Unable to open") return "Email could not be sent. Text message could not be opened on this device.";
  if (email === "Sent") return "Email sent.";
  if (email === "Failed") return "Email could not be sent.";
  if (sms === "Message opened") return "Text message opened on your device.";
  return "Text message could not be opened on this device.";
}
