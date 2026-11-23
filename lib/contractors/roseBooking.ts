import { bravaScopeHeading } from "./bravaScope";

export function parseRoseBooking(message: string, kind: "rose" | "brava" = "rose") {
  const allLines = message.trim().split(/\r?\n/);
  const heading = allLines[0] ?? "";
  const hasHeading = (kind === "brava" ? /^(?:BRAVA NEW BOOKING|BRAVA CREW REMINDER|(?:🚨\s*)?New BRAVA cleaning job)\b/i : /^Rose Company New Booking\b/i).test(heading);
  if (!hasHeading && !/^Customer\s*:/i.test(heading)) {
    throw new Error(`Paste a ${kind === "brava" ? "BRAVA" : "Rose"} booking beginning with Customer:.`);
  }
  const lines = (hasHeading ? allLines.slice(1) : allLines).join("\n")
    .replace(/^(\s*Bedrooms?\s*:[^\n]+?)[^\S\r\n]+(Bathrooms?\s*:)/gim, "$1\n$2").split("\n");
  const fields = new Map<string, string>();
  const addOnHeading = /^(?:add[- ]?ons|additional services)$/i;
  const bookingHeading = /^(?:customer|date|time|team|address|service|bedrooms?|bathrooms?|frequency|pets|price|instructions(?:\s*\/\s*access)?|access|notes)$/i;
  let addOnKey: string | null = null;
  for (const line of lines) {
    const field = line.match(/^\s*([^:]+):\s*(.*)$/);
    const key = field?.[1].trim().toLowerCase();
    if (kind === "brava" && addOnKey && (!key || !bookingHeading.test(key) && !addOnHeading.test(key))) {
      const detail = line.trim().replace(/^[•*-]\s+/, "");
      if (detail) fields.set(addOnKey, [fields.get(addOnKey), detail].filter(Boolean).join(", "));
      continue;
    }
    if (field && key) {
      fields.set(key, field[2].trim());
      addOnKey = kind === "brava" && addOnHeading.test(key) ? key : null;
    }
  }
  const read = (key: string) => fields.get(key) ?? "";
  const address = read("address").match(/^(.+),\s*([^,]+),\s*([a-z]{2})[ ,]+(\d{5}(?:-\d{4})?)$/i);
  const rawDate = read("date");
  const parsedDate = new Date(rawDate);
  const requestedDate = Number.isNaN(parsedDate.getTime()) ? "" :
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate :
    [parsedDate.getFullYear(), String(parsedDate.getMonth() + 1).padStart(2, "0"), String(parsedDate.getDate()).padStart(2, "0")].join("-");
  const appointmentTime = read("time") || (kind === "brava" && /^BRAVA CREW REMINDER\b/i.test(heading) ? read("team") : "");
  const time = appointmentTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  const hour = time ? Number(time[1]) : -1;
  const requestedTime = time && Number(time[2]) < 60 && (time[3] ? hour >= 1 && hour <= 12 : hour < 24)
    ? `${String(time[3] ? hour % 12 + (time[3].toLowerCase() === "pm" ? 12 : 0) : hour).padStart(2, "0")}:${time[2]}`
    : "";
  const price = read("price").replace(/[$,]/g, "").trim();
  const addOns = read("add-ons") || (kind === "brava" ? read("add ons") || read("addons") || read("additional services") : "");
  const streetParts = address?.[1].split(",").map(part => part.trim()) ?? [];
  return {
    propertyName: read("customer"),
    address: streetParts.shift() ?? read("address"),
    addressLine2: streetParts.join(", "),
    city: address?.[2].trim() ?? "",
    state: address?.[3].toUpperCase() ?? "",
    zip: address?.[4] ?? "",
    requestedDate,
    requestedTime,
    serviceType: read("service"),
    bedrooms: read("bedroom") || read("bedrooms"),
    bathrooms: read("bathrooms") || read("bathroom"),
    frequency: read("frequency"),
    pets: read("pets"),
    addOns,
    access: read("instructions / access") || read("instructions/access"),
    amount: kind === "rose" && /^\d+(\.\d{1,2})?$/.test(price) ? price : "",
    scope: [kind === "brava" ? bravaScopeHeading(read("service")) : read("service"), read("frequency") && `Frequency: ${read("frequency")}`,
      addOns && `Add-ons: ${addOns}`].filter(Boolean).join("\n"),
    estimatedHours: "",
  };
}
