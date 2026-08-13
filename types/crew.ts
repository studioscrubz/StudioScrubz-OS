import type { Employee } from "@/types/employee";
export const CREW_STATUSES=["Active","Inactive","Archived"] as const;
export type CrewStatus=(typeof CREW_STATUSES)[number];
export type Crew={id:string;crew_name:string;crew_lead_id:string|null;status:CrewStatus;notes:string|null;created_at:string;updated_at:string;archived_at:string|null};
export type CrewMember={id:string;crew_id:string;employee_id:string;created_at:string;employee:Employee};
export type CrewWithRelations=Crew&{crew_lead:Employee|null;members:CrewMember[]};
export type CrewInput=Omit<Crew,"id"|"created_at"|"updated_at"|"archived_at">;
export type CrewUpdate=Partial<CrewInput>&{archived_at?:string|null};
