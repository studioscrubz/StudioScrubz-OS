import type { GpsPosition } from "@/types/gpsMileage";

export function validatePosition(position: GpsPosition, now = Date.now()): GpsPosition {
  const { latitude, longitude, accuracy } = position;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error("GPS coordinates are invalid. Please retry.");
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) throw new Error("GPS accuracy must be within 100 meters. Move to an open area and retry.");
  const age = now - Date.parse(position.capturedAt);
  if (!Number.isFinite(age) || age > 60000 || age < -10000) throw new Error("GPS position is outdated. Please retry.");
  return position;
}

export function getCurrentPosition(): Promise<GpsPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error("GPS is unavailable. Use manual mileage later."));
    navigator.geolocation.getCurrentPosition((position) => {
      try {
        resolve(validatePosition({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() }));
      } catch (error) { reject(error); }
    }, (error) => reject(new Error(error.code === 1 ? "Location permission was denied. Allow location access or use manual mileage later." : error.code === 3 ? "GPS timed out. Please retry." : "GPS position is unavailable. Please retry or use manual mileage later.")), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  });
}
