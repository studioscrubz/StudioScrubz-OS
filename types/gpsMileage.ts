export type GpsPosition = { latitude: number; longitude: number; accuracy: number; capturedAt: string };
export type GpsMileageTrip = {
  id: string; job_id: string; employee_id: string; vehicle_id: string;
  status: "Active" | "Completed" | "Cancelled";
  started_at: string; ended_at: string | null;
  start_latitude: number; start_longitude: number; start_accuracy: number;
  end_latitude: number | null; end_longitude: number | null; end_accuracy: number | null;
  distance_method: "gps_straight_line_v1"; estimated_miles: number | null;
  mileage_rate_snapshot: number | null; mileage_entry_id: string | null;
  created_at: string; updated_at: string;
};
export type GpsMileageSummary = { id: string; trip_date: string; miles: number; trip_purpose: string; vehicle_label: string; employee_name: string; deductible_amount: number };
export const GPS_DISTANCE_NOTICE = "GPS-estimated straight-line distance — not driven road mileage.";
