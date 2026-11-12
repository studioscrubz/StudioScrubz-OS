export type JobAssignmentEvent = {
  id:string; job_id:string; recipient_user_id:string;
  event_type:'Assigned'|'Changed'|'Removed'|'Cancelled'; job_number:string;
  scheduled_date:string|null; start_time:string|null; assignment_label:string; created_at:string;
};
