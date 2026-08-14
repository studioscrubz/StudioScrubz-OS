import type { Crew } from "@/types/crew";
import type { Employee } from "@/types/employee";

export const VEHICLE_TYPES = ["Car", "SUV", "Truck", "Van", "Trailer", "Other"] as const;
export const VEHICLE_OWNERSHIP_TYPES = ["Company Owned", "Leased", "Personal", "Rental", "Other"] as const;
export const VEHICLE_STATUSES = ["Active", "Maintenance", "Inactive", "Archived"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type VehicleOwnershipType = (typeof VEHICLE_OWNERSHIP_TYPES)[number];
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export type Vehicle = { id:string; vehicle_number:string; nickname:string|null; year:number|null; make:string; model:string; color:string|null; license_plate:string|null; vin:string|null; vehicle_type:VehicleType|null; ownership_type:VehicleOwnershipType|null; status:VehicleStatus; assigned_employee_id:string|null; assigned_crew_id:string|null; current_odometer:number|null; notes:string|null; created_at:string; updated_at:string; archived_at:string|null };
export type VehicleInput = Omit<Vehicle,"id"|"vehicle_number"|"created_at"|"updated_at"|"archived_at">;
export type VehicleUpdate = Partial<VehicleInput>&{archived_at?:string|null};
export type VehicleWithRelations = Vehicle&{assigned_employee:Employee|null;assigned_crew:Crew|null};
export function vehicleLabel(vehicle:Pick<Vehicle,"vehicle_number"|"nickname"|"year"|"make"|"model">|null){return vehicle?vehicle.nickname?.trim()||`${vehicle.year??""} ${vehicle.make} ${vehicle.model}`.trim()||vehicle.vehicle_number:"Deleted Vehicle"}
