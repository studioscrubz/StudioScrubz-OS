import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sendResendEmail } from "@/lib/email/resend";
import { resolveEmailSenderProfile } from "@/lib/email/senderProfiles";
import { escapeEmailHtml } from "@/lib/email/studioScrubzTemplate";

const portal = "https://partners.studioscrubz.com";
const steps = [
  "Submit New Opportunities: Submit all new cleaning requests through the Contractor Portal with the service location, property details, cleaning requirements, proposed compensation, and requested service date and time.",
  "StudioScrubz Review: Our Operations Team reviews each submission, confirms the scope of work, and discusses any adjustments before accepting the opportunity.",
  "Approval & Scheduling: Once StudioScrubz accepts the opportunity, we coordinate technician assignments and confirm scheduling. Submitting a request does not guarantee acceptance or availability.",
  "Job Updates & Communication: Use the Contractor Portal for job updates, scheduling changes, and additional requests so we can keep accurate records.",
  "Service Completion: We complete the approved scope and update the job status. You can monitor completed jobs and related payment information in the portal.",
];

export async function sendContractorWelcome(company: { id: string; name: string; contactName: string; email: string }) {
  const intro = [
    `Hello ${company.contactName || company.name},`,
    "Welcome to StudioScrubz!",
    "We're excited to establish this partnership and look forward to working together. Use the StudioScrubz Contractor Portal to manage subcontracted cleaning opportunities, communicate with Operations, and track scheduled and completed jobs.",
  ];
  const gettingStarted = "You'll receive a separate invitation to register and activate your Contractor Portal account.";
  const scheduling = "StudioScrubz cannot schedule or dispatch technicians for subcontracted work that has not been submitted and approved through the Contractor Portal. Please submit opportunities early to allow time for review, acceptance, and crew coordination.";
  const guide = "Please review the attached StudioScrubz Contractor Portal Workflow & iPhone Installation Guide before submitting your first opportunity. It explains how to add the portal to your iPhone Home Screen.";
  const commitment = "Our goal is to make working with StudioScrubz simple, organized, and dependable. We value your partnership and are committed to clear communication, professional service, and reliable scheduling. If you need help getting started, please contact our Operations Team.";
  const closing = "Thank you for choosing to partner with StudioScrubz. We look forward to working with you!";
  const signature = [
    "Best regards,",
    "Crystal Garcia",
    "Operations Manager | StudioScrubz",
    "213-338-9556",
    "crystalgarcia@studioscrubz.com",
    "www.StudioScrubz.com",
    "No mess. No stress.",
  ];
  const paragraph = (value: string) => `<p>${escapeEmailHtml(value)}</p>`;
  const pdf = await readFile(join(process.cwd(), "assets/email/contractor-workflow-and-iphone-guide.pdf"));
  return sendResendEmail({
    ...resolveEmailSenderProfile("contractorInvitation"),
    replyTo: "crystalgarcia@studioscrubz.com",
    recipientEmail: company.email,
    subject: "Welcome to the StudioScrubz Contractor Portal",
    idempotencyKey: `contractor-welcome:${company.id}`,
    text: [
      ...intro, "Getting Started", gettingStarted, `Contractor Portal: ${portal}`,
      "Required Job Submission & Scheduling Process", steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      "Important Scheduling Requirement", scheduling, "Contractor Portal Guide", guide,
      "Our Commitment to You", commitment, closing, signature.join("\n"),
    ].join("\n\n"),
    html: [
      ...intro.map(paragraph), "<h2>Getting Started</h2>", paragraph(gettingStarted),
      `<p><a href="${portal}">Open the Contractor Portal</a></p>`,
      "<h2>Required Job Submission &amp; Scheduling Process</h2>",
      `<ol>${steps.map(step => `<li>${escapeEmailHtml(step)}</li>`).join("")}</ol>`,
      "<h2>Important Scheduling Requirement</h2>", paragraph(scheduling),
      "<h2>Contractor Portal Guide</h2>", paragraph(guide),
      "<h2>Our Commitment to You</h2>", paragraph(commitment), paragraph(closing),
      `<p>${signature.map(escapeEmailHtml).join("<br/>")}</p>`,
    ].join(""),
    attachments: [{
      filename: "StudioScrubz Contractor Portal Workflow and iPhone Guide.pdf",
      content: pdf.toString("base64"),
      contentType: "application/pdf",
    }],
  });
}
