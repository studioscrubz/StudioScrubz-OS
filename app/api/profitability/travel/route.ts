import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- new migration-backed cache is intentionally unavailable to generated types until applied. */
import { createHash } from "node:crypto";
import { hasPermission } from "@/lib/auth/permissions";
import { confidentlyVerified, normalizePropertyAddress, parseGeocodingResponse, parseRoutingResponse } from "@/lib/porterGeoapify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateProfitabilitySettings } from "@/lib/pricing/profitabilitySettings";
import type { UserProfile } from "@/types/auth";
import type { TravelProjection } from "@/types/profitability";

const miles = (meters: number) => Math.round((meters / 1609.344) * 100) / 100;
const minutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10;
const cacheHours = 24;

export async function POST(request: Request) {
  try {
    const session = await createSupabaseServerClient();
    const { data: auth } = await session.auth.getUser();
    if (!auth.user) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const { data: profileRow, error: profileError } = await session.from("user_profiles").select("*").eq("id", auth.user.id).single();
    const profile = profileRow as UserProfile | null;
    if (profileError || !profile || !hasPermission(profile, "finances.view")) return Response.json({ error: "Internal profitability access is required." }, { status: 403 });
    const raw = await request.json() as { destination?: unknown };
    const destination = typeof raw.destination === "string" ? raw.destination.trim() : "";
    if (destination.length > 500) return Response.json({ error: "The destination address is too long." }, { status: 400 });

    const admin = createSupabaseAdminClient() as unknown as any;
    const { data: settingsRow, error: settingsError } = await admin.from("profitability_settings").select("settings").eq("singleton", true).single();
    if (settingsError || !settingsRow) throw new Error("Profitability settings are unavailable.");
    const settings = validateProfitabilitySettings(settingsRow.settings);
    let normalizedDestination: string;
    try { normalizedDestination = normalizePropertyAddress([destination]); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Enter a complete destination address." }, { status: 400 }); }
    const base: Omit<TravelProjection, "verification" | "provider" | "roundTripMiles" | "roundTripMinutes" | "warning" | "calculatedAt"> = {
      origin: settings.travelOrigin,
      destination: normalizedDestination,
      vehicleCount: settings.defaultVehiclesPerJob,
      travelingEmployeeCount: 1,
      companyRequiredTravelIsCompensable: settings.companyRequiredTravelIsCompensable,
    };
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) return Response.json({ travel: unavailable(base, "Geoapify is not configured. Enter a manual mileage and duration override; travel costs remain unverified.") });
    const cacheKey = stableKey(settings.travelOrigin, normalizedDestination);
    const { data: cached } = await admin.from("profitability_route_cache").select("route").eq("cache_key", cacheKey).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.route) return Response.json({ travel: routeFromCache(cached.route, base) });

    const origin = await geocode(settings.travelOrigin, apiKey);
    const target = await geocode(normalizedDestination, apiKey);
    if (!confidentlyVerified([target])) return Response.json({ travel: unavailable(base, "The destination address could not be confidently verified. Enter a manual mileage and duration override.") });
    const url = new URL("https://api.geoapify.com/v1/routing");
    url.searchParams.set("waypoints", `${origin.latitude},${origin.longitude}|${target.latitude},${target.longitude}`);
    url.searchParams.set("mode", "drive");
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", apiKey);
    const response = await provider(url);
    const route = parseRoutingResponse(response);
    const oneWayMiles = miles(route.distanceMeters);
    const oneWayMinutes = minutes(route.durationSeconds);
    const travel: TravelProjection = {
      ...base,
      verification: "Verified",
      provider: "Geoapify",
      roundTripMiles: Math.round(oneWayMiles * 2 * 100) / 100,
      roundTripMinutes: Math.round(oneWayMinutes * 2 * 10) / 10,
      warning: null,
      calculatedAt: new Date().toISOString(),
    };
    await admin.from("profitability_route_cache").upsert({ cache_key: cacheKey, origin: settings.travelOrigin, destination: normalizedDestination, provider: "Geoapify", route: travel, expires_at: new Date(Date.now() + cacheHours * 60 * 60 * 1000).toISOString() });
    return Response.json({ travel });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Travel could not be calculated." }, { status: 503 });
  }
}

async function geocode(address: string, apiKey: string) {
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", address);
  url.searchParams.set("filter", "countrycode:us");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "2");
  url.searchParams.set("apiKey", apiKey);
  const candidates = parseGeocodingResponse(await provider(url));
  if (!confidentlyVerified(candidates)) throw new Error("The route origin or destination could not be confidently verified.");
  return candidates[0];
}

async function provider(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("The routing provider is unavailable. Enter a manual mileage and duration override.");
    return await response.json();
  } finally { clearTimeout(timer); }
}

function unavailable(base: Omit<TravelProjection, "verification" | "provider" | "roundTripMiles" | "roundTripMinutes" | "warning" | "calculatedAt">, warning: string): TravelProjection {
  return { ...base, verification: "Unverified", provider: null, roundTripMiles: null, roundTripMinutes: null, warning, calculatedAt: null };
}

function routeFromCache(value: unknown, base: Omit<TravelProjection, "verification" | "provider" | "roundTripMiles" | "roundTripMinutes" | "warning" | "calculatedAt">): TravelProjection {
  if (!value || typeof value !== "object") return unavailable(base, "The cached travel route is invalid. Enter a manual mileage and duration override.");
  const row = value as Partial<TravelProjection>;
  if (row.verification !== "Verified" || !Number.isFinite(row.roundTripMiles) || !Number.isFinite(row.roundTripMinutes)) return unavailable(base, "The cached travel route is unavailable. Enter a manual mileage and duration override.");
  return { ...base, verification: "Verified", provider: "Geoapify", roundTripMiles: Number(row.roundTripMiles), roundTripMinutes: Number(row.roundTripMinutes), warning: null, calculatedAt: typeof row.calculatedAt === "string" ? row.calculatedAt : null };
}

function stableKey(origin: string, destination: string) {
  return createHash("sha256").update(`${origin.toLowerCase()}\n${destination.toLowerCase()}`).digest("hex");
}
