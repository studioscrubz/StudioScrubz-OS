import assert from "node:assert/strict";
import test from "node:test";
import { bravaPayout } from "../lib/contractors/bravaPayout.ts";

const price = (service, beds, baths, addOns = "", date = "2026-11-23") =>
  bravaPayout(service, beds, baths, addOns, date);

test("Exhibit B base amounts include the added layouts and correct cent precision", () => {
  assert.equal(price("Standard Cleaning", 1, 2).total, 148);
  assert.equal(price("Standard Cleaning", 4, 4.5).total, 254.99);
  assert.equal(price("Brazilian Deep Clean", 4, 5).total, 442);
  assert.equal(price("Deep Cleaning", 3, 4).total, 355);
  assert.equal(price("Move-In Cleaning", 5, 3.5).total, 470.65);
  assert.equal(price("Move-Out Cleaning", 5, 5).total, 512);
});

test("Totals itemize approved extras and exclude services included in the package", () => {
  const deep = price("Deep Cleaning", 2, 2, "Inside oven, Interior windows: 7–10, 12 detailed blinds, Balcony glass");
  assert.deepEqual(deep.lines.map(line => line.cents), [24800, 3500, 2800, 4900, 1400]);
  assert.equal(deep.total, 374);
  assert.equal(price("Deep Cleaning", 1, 1, "Interior windows: 6; Detailed blinds: 1–6").total, 193);
  assert.equal(price("Move-Out Cleaning", 1, 1, "BRAVA Appliance Special — oven + refrigerator, Balcony glass").total, 232);
});

test("Unlisted, duplicate, ambiguous and pre-effective bookings require confirmed pricing", () => {
  assert.equal(price("Standard Cleaning", "studio", 1), null);
  assert.equal(price("Standard Cleaning", 5, 5.5), null);
  assert.equal(price("Standard Cleaning", 1, 1, "None", "2026-11-22"), null);
  assert.equal(price("Deep Cleaning", 1, 1, "Excessive cleaning fee"), null);
  assert.equal(price("Deep Cleaning", 1, 1, "Interior windows: 5–10"), null);
  assert.equal(price("Deep Cleaning", 1, 1, "BRAVA Appliance Special, inside oven"), null);
});
