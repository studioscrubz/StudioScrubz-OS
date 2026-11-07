export const PARTNER_HOST = "partners.studioscrubz.com";

export function isPartnerHost(host: string | null | undefined) {
  return host?.split(":")[0].toLowerCase() === PARTNER_HOST;
}

export function contractorPage(page: "/" | "/login") {
  if (isPartnerHost(window.location.host)) return page;
  return page === "/" ? "/contractor" : "/contractor/login";
}
