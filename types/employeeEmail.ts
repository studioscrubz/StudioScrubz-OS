import type { EmployeeDepartment } from "@/types/employee";

export type EmployeeEmailDirectoryEntry = { id: string; name: string; email: string | null; department: EmployeeDepartment; available: boolean; unavailableReason: string | null };
export type EmployeeEmailRecipient = { employeeId: string; name: string; email: string; department: EmployeeDepartment };
export type EmployeeEmailHistory = { id: string; requestId: string; employeeId: string; employeeName: string; recipientEmail: string; department: EmployeeDepartment; subject: string; senderName: string; status: "Pending" | "Accepted" | "Failed"; providerMessageId: string | null; failureReason: string | null; createdAt: string; acceptedAt: string | null; failedAt: string | null };
export type EmployeeEmailSelection = { mode: "selected"; employeeIds: string[] } | { mode: "department"; department: EmployeeDepartment };
export type EmployeeEmailPreview = { recipients: EmployeeEmailRecipient[]; unavailable: EmployeeEmailDirectoryEntry[]; recipientCount: number };
export type EmployeeEmailWorkspace = { employees: EmployeeEmailDirectoryEntry[]; departments: EmployeeDepartment[]; history: EmployeeEmailHistory[] };
export type EmployeeEmailSendResult = { requestId: string; accepted: number; failed: number; pending: number; deliveries: EmployeeEmailHistory[] };
