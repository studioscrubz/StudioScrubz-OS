export const contractorScheduledJobStatuses = ["Scheduled", "Crew Assigned", "In Progress"];

export type ContractorScheduledJob = {
 id: string;
 job_number: string;
 service_name: string | null;
 property_name: string | null;
 location: string | null;
 scheduled_date: string;
 start_time: string | null;
};
