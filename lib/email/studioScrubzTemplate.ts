import "server-only";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";

export type EmailBrandContact = {
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

const BRAND_MARKER = 'data-studioscrubz-email="v1"';

export function renderStudioScrubzEmail(contentHtml: string, contact: EmailBrandContact = {}): string {
  if (contentHtml.includes(BRAND_MARKER)) return contentHtml;
  const businessName = clean(contact.businessName) || "StudioScrubz";
  const logoUrl = studioScrubzLogoUrl();
  const contacts = contactLinks(contact);
  const content = emailBodyContent(contentHtml);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:#f4f6f2;color:#202820"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4f6f2"><tr><td align="center" style="padding:24px 12px"><table ${BRAND_MARKER} role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#202820;line-height:1.6"><tr><td align="center" bgcolor="#FFFFFF" style="padding:28px 24px 22px;background-color:#FFFFFF;border-top:5px solid #D4AF37;border-bottom:1px solid #dfe7dd"><img src="${escapeHtml(logoUrl)}" width="180" alt="StudioScrubz cleaning services logo" style="display:block;width:180px;max-width:65%;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto"><div style="margin-top:10px;color:#143D1A;font-size:16px;font-weight:bold;letter-spacing:.2px">No mess. No stress.</div></td></tr><tr><td style="padding:30px 28px;font-size:16px">${content}</td></tr><tr><td align="center" style="padding:22px 24px;background:#143D1A;color:#ffffff;font-size:13px"><div style="font-size:16px;font-weight:bold">${escapeHtml(businessName)}</div><div style="margin-top:4px;color:#D4AF37;font-weight:bold">No mess. No stress.</div>${contacts ? `<div style="margin-top:12px;color:#ffffff">${contacts}</div>` : ""}<div style="margin-top:14px;color:#dce7da;font-size:11px">This message was sent by StudioScrubz.</div></td></tr></table></td></tr></table></body></html>`;
}

export function isStudioScrubzBrandedEmail(html: string): boolean {
  return html.includes(BRAND_MARKER);
}

export function studioScrubzLogoUrl(): string {
  const url = new URL("/branding/studioscrubz-logo.png", `${getPublicSiteUrl()}/`);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("The StudioScrubz email logo requires an HTTPS public site URL.");
  return url.toString();
}

function contactLinks(contact: EmailBrandContact): string {
  const parts: string[] = [];
  const phone = clean(contact.phone);
  const email = clean(contact.email);
  const website = safeHttpsUrl(contact.website);
  if (phone) parts.push(`<span style="white-space:nowrap">${escapeHtml(phone)}</span>`);
  if (email) parts.push(`<a href="mailto:${escapeHtml(email)}" style="color:#ffffff;text-decoration:underline">${escapeHtml(email)}</a>`);
  if (website) parts.push(`<a href="${escapeHtml(website)}" style="color:#ffffff;text-decoration:underline">${escapeHtml(displayWebsite(website))}</a>`);
  return parts.join('<span aria-hidden="true" style="color:#D4AF37"> &nbsp;•&nbsp; </span>');
}

function emailBodyContent(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  return (body ?? html).replace(/^\s*<!doctype[^>]*>/i, "").replace(/^\s*<html\b[^>]*>/i, "").replace(/<\/html>\s*$/i, "");
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function displayWebsite(value: string): string { return new URL(value).hostname.replace(/^www\./, ""); }
function clean(value: string | null | undefined): string { return value?.trim() || ""; }
export function escapeEmailHtml(value: string): string { return escapeHtml(value); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
