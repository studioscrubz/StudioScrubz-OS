export const JOB_APPLICATION_STATUSES=["New","Contacted","Interviewing","Selected","Declined"] as const;
export type JobApplicationStatus=typeof JOB_APPLICATION_STATUSES[number];
export type JobApplicationEvent={id:string;event_type:"Submitted"|"Status Changed"|"Notes Updated";from_status:string|null;to_status:string|null;actor_user_id:string|null;created_at:string};
export type JobApplication={id:string;full_name:string;email:string;phone:string;city:string;preferred_contact_method:"Email"|"Phone"|"Text";relevant_experience:string;reachable_networks:string;weekly_availability:string;fit_reason:string;status:JobApplicationStatus;internal_notes:string|null;notification_status:"Prepared"|"Sent"|"Failed";created_at:string;updated_at:string;events:JobApplicationEvent[]};
