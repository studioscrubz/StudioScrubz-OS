export type EmployeeWorkSessionStatus = "Open" | "Completed";

export type EmployeeWorkSession = {
  id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  status: EmployeeWorkSessionStatus;
  created_at: string;
  updated_at: string;
};

export type ActiveEmployeeWorkSession = Pick<
  EmployeeWorkSession,
  "id" | "employee_id" | "clock_in" | "status" | "created_at" | "updated_at"
> & {
  employee_number: string;
  employee_name: string;
};

export type ActiveStaffStatus = ActiveEmployeeWorkSession & {
  availability: "Active / Available" | "On Job / Unavailable";
  job_id: string | null;
  job_number: string | null;
  joined_at: string | null;
};
