export function parseRoseBooking(message: string, kind: "rose" | "brava" = "rose") {
  const allLines = message.trim().split(/\r?\n/);
  const heading = allLines[0] ?? "";
  const hasHeading = (kind === "brava" ? /^(?:BRAVA NEW BOOKING|(?:🚨\s*)?New BRAVA cleaning job)\b/i : /^Rose Company New Booking\b/i).test(heading);
  if (!hasHeading && !/^Customer\s*:/i.test(heading)) {
    throw new Error(`Paste a ${kind === "brava" ? "BRAVA" : "Rose"} booking beginning with Customer:.`);
  }
  const lines = (hasHeading ? allLines.slice(1) : allLines).join("\n")
    .replace(/^(\s*Bedrooms?\s*:[^\n]+?)[^\S\r\n]+(Bathrooms?\s*:)/gim, "$1\n$2").split("\n");
  const fields = new Map<string, string>();
  for (const line of lines) {
    const field = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (field) fields.set(field[1].trim().toLowerCase(), field[2].trim());
  }
  const read = (key: string) => fields.get(key) ?? "";
  const address = read("address").match(/^(.+),\s*([^,]+),\s*([a-z]{2})[ ,]+(\d{5}(?:-\d{4})?)$/i);
  const rawDate = read("date");
  const parsedDate = new Date(rawDate);
  const requestedDate = Number.isNaN(parsedDate.getTime()) ? "" :
    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate :
    [parsedDate.getFullYear(), String(parsedDate.getMonth() + 1).padStart(2, "0"), String(parsedDate.getDate()).padStart(2, "0")].join("-");
  const time = read("time").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  const hour = time ? Number(time[1]) : -1;
  const requestedTime = time && Number(time[2]) < 60 && (time[3] ? hour >= 1 && hour <= 12 : hour < 24)
    ? `${String(time[3] ? hour % 12 + (time[3].toLowerCase() === "pm" ? 12 : 0) : hour).padStart(2, "0")}:${time[2]}`
    : "";
  const price = read("price").replace(/[$,]/g, "").trim();
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
    pets: read("pets"),
    addOns: read("add-ons"),
    access: read("instructions / access") || read("instructions/access"),
    amount: kind === "rose" && /^\d+(\.\d{1,2})?$/.test(price) ? price : "",
    scope: [read("service"), read("frequency") && `Frequency: ${read("frequency")}`,
      read("add-ons") && `Add-ons: ${read("add-ons")}`].filter(Boolean).join("\n"),
    estimatedHours: "",
  };
}
