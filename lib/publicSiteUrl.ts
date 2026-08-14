export function getPublicSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const fallback = typeof window !== "undefined" ? window.location.origin : "";
  const siteUrl = configured || fallback;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is required for client-facing links.");
  return siteUrl.replace(/\/+$/, "");
}
