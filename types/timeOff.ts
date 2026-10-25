export type TimeOffStatus = "Pending" | "Approved" | "Denied" | "Cancelled";
export type LeaveCategory = "Vacation" | "Sick" | "Personal" | "Bereavement" | "Jury Duty" | "Other";
export type TimeOffRequest = {
  id:string; employee_id:string; employee_name?:string; start_date:string; end_date:string;
  is_full_day:boolean; start_time:string|null; end_time:string|null; leave_category:LeaveCategory;
  employee_notes:string|null; status:TimeOffStatus; submitted_at:string; decision_notes:string|null;
  decided_at:string|null; revision:number; history?:Array<{id:string;event_type:string;from_status:string|null;to_status:string;notes:string|null;created_at:string}>;
};
export type ApprovedAbsence = Pick<TimeOffRequest,"id"|"employee_id"|"start_date"|"end_date"|"is_full_day"|"start_time"|"end_time"> & {employee_name:string};
