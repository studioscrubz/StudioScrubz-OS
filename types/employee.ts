export const EMPLOYEE_DEPARTMENTS=["Scrub Technicians","Sales","Administration","Management"] as const;
export const EMPLOYMENT_STATUSES=["Active","Inactive","On Leave","Terminated","Archived"] as const;
export const EMPLOYMENT_TYPES=["Full-Time","Part-Time","On-Call","1099","Temporary"] as const;
export type EmployeeDepartment=(typeof EMPLOYEE_DEPARTMENTS)[number];
export type EmploymentStatus=(typeof EMPLOYMENT_STATUSES)[number];
export type EmploymentType=(typeof EMPLOYMENT_TYPES)[number];
export type Employee={id:string;employee_number:string;first_name:string;last_name:string;preferred_name:string|null;email:string|null;phone:string|null;department:EmployeeDepartment;job_title:string|null;employment_status:EmploymentStatus;employment_type:EmploymentType|null;hourly_rate:number;overtime_rate:number;commission_rate:number;hire_date:string|null;notes:string|null;created_at:string;updated_at:string;archived_at:string|null};
export type EmployeeInput=Omit<Employee,"id"|"employee_number"|"created_at"|"updated_at"|"archived_at"|"overtime_rate">&{overtime_rate?:number};
export type EmployeeUpdate=Partial<EmployeeInput> & {archived_at?:string|null};
export function employeeName(e:Pick<Employee,"first_name"|"last_name"|"preferred_name">|null){return e?e.preferred_name?.trim()||`${e.first_name} ${e.last_name}`.trim():"Deleted Employee"}
