import type { Client } from "@/types/client";
import type { Crew } from "@/types/crew";
import type { Employee } from "@/types/employee";
import type { Job } from "@/types/job";
import type { Property } from "@/types/property";
import type { Vehicle } from "@/types/vehicle";

export const MILEAGE_STATUSES=["Active","Voided","Archived"] as const;
export type MileageStatus=(typeof MILEAGE_STATUSES)[number];
export type MileageEntry={id:string;mileage_number:string;trip_date:string;vehicle_id:string|null;employee_id:string|null;crew_id:string|null;job_id:string|null;client_id:string|null;property_id:string|null;trip_purpose:string;start_location:string|null;end_location:string|null;start_odometer:number|null;end_odometer:number|null;miles:number;round_trip:boolean;business_use:boolean;mileage_rate:number|null;deductible_amount:number;notes:string|null;status:MileageStatus;created_at:string;updated_at:string;archived_at:string|null};
export type MileageInput=Omit<MileageEntry,"id"|"mileage_number"|"deductible_amount"|"status"|"created_at"|"updated_at"|"archived_at">;
export type MileageUpdate=Partial<MileageInput>&{deductible_amount?:number;status?:MileageStatus;archived_at?:string|null};
export type MileageStop={id:string;mileage_entry_id:string;stop_order:number;job_id:string|null;property_id:string|null;address:string;label:string|null;miles_from_previous:number|null;created_at:string;updated_at:string};
export type MileageStopInput=Pick<MileageStop,"job_id"|"property_id"|"address"|"label"|"miles_from_previous">;
export type MileageStopWithRelations=MileageStop&{job:Pick<Job,"id"|"job_number"|"status"|"client_id"|"property_id"|"client_name"|"property_name">|null;property:Pick<Property,"id"|"client_id"|"property_name"|"address"|"address_line_2"|"city"|"state"|"zip">|null};
export type MileageWithRelations=MileageEntry&{vehicle:Vehicle|null;employee:Employee|null;crew:Crew|null;job:Job|null;client:Client|null;property:Property|null;stops:MileageStopWithRelations[]};
export type MileageSummary={thisMonth:number;thisYear:number;businessMiles:number;personalMiles:number;deductibleAmount:number;averageMiles:number};
export type MileageCalculationInput={startOdometer:number|null;endOdometer:number|null;manualMiles:number;roundTrip:boolean;mileageRate:number|null};
