// Approved technician kit baseline; no live stock is implied.
export const KIT_VERSION = "1.0";
export const KIT_ITEMS = [
  {
    "id": "microfiber",
    "name": "Microfiber towels",
    "kit": "essentials",
    "target": 100,
    "threshold": 35,
    "unit": "towels"
  },
  {
    "id": "trash",
    "name": "Trash bags",
    "kit": "essentials",
    "target": 20,
    "threshold": 5,
    "unit": "bags"
  },
  {
    "id": "gloves",
    "name": "Disposable gloves",
    "kit": "essentials",
    "target": 40,
    "threshold": 10,
    "unit": "pairs"
  },
  {
    "id": "shoe",
    "name": "Shoe covers",
    "kit": "essentials",
    "target": 10,
    "threshold": 5,
    "unit": "pairs"
  },
  {
    "id": "paper",
    "name": "Paper towels",
    "kit": "essentials",
    "target": 2,
    "threshold": 1,
    "unit": "rolls"
  },
  {
    "id": "bucket",
    "name": "5-gallon bucket",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "organizer",
    "name": "Bucket organizer",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "cart",
    "name": "Transport cart",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "disinfectant",
    "name": "Disinfectant spray bottle",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "glass",
    "name": "Glass cleaner spray bottle",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "alcohol",
    "name": "Alcohol cleaner spray bottle",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "degreaser",
    "name": "Degreaser spray bottle",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "wood",
    "name": "Wood cleaner",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "air",
    "name": "Air freshener",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "toilet",
    "name": "Toilet bowl cleaner",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "powerwash",
    "name": "Dawn Powerwash",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "sponges",
    "name": "Scrub Daddy sponges",
    "kit": "standard",
    "target": 2,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "steamer",
    "name": "Floor steamer",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "vacuum",
    "name": "Vacuum",
    "kit": "standard",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "scraper",
    "name": "Scraper",
    "kit": "deep",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "pink",
    "name": "The Pink Stuff cleaning paste",
    "kit": "deep",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "bkf",
    "name": "Bar Keepers Friend liquid",
    "kit": "deep",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "shower",
    "name": "Shower cleaner",
    "kit": "specialty",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "mold",
    "name": "Mold and mildew cleaner",
    "kit": "specialty",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "grout",
    "name": "Grout cleaner",
    "kit": "specialty",
    "target": 1,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "brushes",
    "name": "Grout brushes",
    "kit": "specialty",
    "target": 2,
    "threshold": null,
    "unit": "each"
  },
  {
    "id": "steel",
    "name": "Steel wool cleaning towels",
    "kit": "specialty",
    "target": 2,
    "threshold": null,
    "unit": "each"
  }
] as const;
export const TOWEL_COLORS = [
  {
    "name": "Red",
    "use": "Toilets",
    "target": 15,
    "threshold": 5
  },
  {
    "name": "Yellow",
    "use": "Bathroom surfaces",
    "target": 15,
    "threshold": 5
  },
  {
    "name": "Green",
    "use": "Kitchen",
    "target": 15,
    "threshold": 5
  },
  {
    "name": "Blue",
    "use": "Glass and mirrors",
    "target": 15,
    "threshold": 5
  },
  {
    "name": "Orange",
    "use": "General surfaces, furniture and dusting",
    "target": 30,
    "threshold": 10
  },
  {
    "name": "Gray",
    "use": "Stainless steel",
    "target": 10,
    "threshold": 5
  }
] as const;
export const BULK_PRODUCTS = [
  {
    "name": "Zep Antibacterial Disinfectant with Lemon",
    "targetOz": 128,
    "thresholdOz": 32
  },
  {
    "name": "Dawn Ultra Original",
    "targetOz": 56,
    "thresholdOz": 14
  },
  {
    "name": "Zep Heavy-Duty Citrus Degreaser",
    "targetOz": 128,
    "thresholdOz": 32
  },
  {
    "name": "Zep Neutral pH Floor Cleaner",
    "targetOz": 128,
    "thresholdOz": 32
  },
  {
    "name": "90% isopropyl rubbing alcohol",
    "targetOz": null,
    "thresholdFraction": 0.25
  }
] as const;
export type ResidentialKitService = "standard" | "deep" | "move-in-out";
export function requiredKitItems(service: ResidentialKitService, specialtyIds: readonly string[] = []) {
  if (!["standard","deep","move-in-out"].includes(service)) throw new Error("Unsupported kit service");
  if (specialtyIds.some(id=>!KIT_ITEMS.some(item=>item.kit==="specialty" && item.id===id))) throw new Error("Unknown specialty item");
  return KIT_ITEMS.filter(item=>item.kit==="essentials" || item.kit==="standard" || (service!=="standard" && (item.kit==="deep" || (item.kit==="specialty" && specialtyIds.includes(item.id)))));
}
export function replenishment(target:number,current:number,threshold:number) {
  if (![target,current,threshold].every(Number.isFinite) || target<0 || current<0 || threshold<0 || threshold>target) throw new Error("Invalid stock quantity");
  return {due:current<=threshold,quantity:Math.max(0,target-current)};
}
