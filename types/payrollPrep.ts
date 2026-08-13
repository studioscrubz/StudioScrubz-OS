import type {EmployeeDepartment} from "@/types/employee";
export type PayrollPeriod={start:string;end:string;label:string};
export type EmployeePayrollPrepRow={employeeId:string;employeeNumber:string;employeeName:string;department:EmployeeDepartment;regularHours:number;overtimeHours:number;totalHours:number;regularPay:number;overtimePay:number;grossPay:number};
export type PayrollPrepSummary={totalEmployees:number;regularHours:number;overtimeHours:number;totalHours:number;estimatedGrossPayroll:number;rows:EmployeePayrollPrepRow[]};
