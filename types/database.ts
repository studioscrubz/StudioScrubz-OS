import type { Client, ClientInput } from "@/types/client";
import type { Property, PropertyInput } from "@/types/property";
import type { Estimate, EstimateInsert, EstimateUpdate } from "@/types/estimate";
import type { Walkthrough, WalkthroughInput, WalkthroughUpdate } from "@/types/walkthrough";
import type { Proposal, ProposalHistory, ProposalInsert, ProposalUpdate } from "@/types/proposal";
import type { Job, JobInsert, JobUpdate } from "@/types/job";
import type { Employee, EmployeeInput, EmployeeUpdate } from "@/types/employee";
import type { Crew, CrewInput, CrewMember, CrewUpdate } from "@/types/crew";
import type { Invoice, InvoiceUpdate } from "@/types/invoice";
import type { Payment, PaymentInsert } from "@/types/payment";
import type {Expense,ExpenseInput,ExpenseUpdate} from "@/types/expense";
import type {Vehicle,VehicleInput,VehicleUpdate} from "@/types/vehicle";
import type {MileageEntry,MileageInput,MileageUpdate} from "@/types/mileage";
import type {TimeEntry,TimeEntryInput,TimeEntryUpdate} from "@/types/timeEntry";
import type {ServiceAgreement,AgreementInput,AgreementUpdate} from "@/types/agreement";
import type {ServiceOccurrence} from "@/types/serviceOccurrence";
import type {UserProfile} from "@/types/auth";

export interface Database {
  public: {
    Tables: {
      user_profiles:{Row:UserProfile;Insert:UserProfile;Update:Pick<UserProfile,"display_name">;Relationships:[]};
      clients: {
        Row: Client;
        Insert: ClientInput & { id?: string; created_at?: string; updated_at?: string; archived_at?: string | null };
        Update: Partial<ClientInput> & { updated_at?: string; archived_at?: string | null };
        Relationships: [];
      };
      properties: {
        Row: Property;
        Insert: PropertyInput & { id?: string; created_at?: string; updated_at?: string; archived_at?: string | null };
        Update: Partial<PropertyInput> & { updated_at?: string; archived_at?: string | null };
        Relationships: [{ foreignKeyName: "properties_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }];
      };
      estimates: {
        Row: Estimate;
        Insert: EstimateInsert & { id?: string; created_at?: string; updated_at?: string };
        Update: EstimateUpdate;
        Relationships: [
          { foreignKeyName: "estimates_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "estimates_property_id_fkey"; columns: ["property_id"]; isOneToOne: false; referencedRelation: "properties"; referencedColumns: ["id"] },
        ];
      };
      walkthroughs: {
        Row: Walkthrough;
        Insert: WalkthroughInput & { id?: string; created_at?: string; updated_at?: string };
        Update: WalkthroughUpdate;
        Relationships: [
          { foreignKeyName: "walkthroughs_estimate_id_fkey"; columns: ["estimate_id"]; isOneToOne: false; referencedRelation: "estimates"; referencedColumns: ["id"] },
          { foreignKeyName: "walkthroughs_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "walkthroughs_property_id_fkey"; columns: ["property_id"]; isOneToOne: false; referencedRelation: "properties"; referencedColumns: ["id"] },
        ];
      };
      proposals: { Row: Proposal; Insert: ProposalInsert & { id?: string; created_at?: string; updated_at?: string }; Update: ProposalUpdate; Relationships: [
        { foreignKeyName: "proposals_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
        { foreignKeyName: "proposals_property_id_fkey"; columns: ["property_id"]; isOneToOne: false; referencedRelation: "properties"; referencedColumns: ["id"] },
        { foreignKeyName: "proposals_estimate_id_fkey"; columns: ["estimate_id"]; isOneToOne: false; referencedRelation: "estimates"; referencedColumns: ["id"] },
        { foreignKeyName: "proposals_walkthrough_id_fkey"; columns: ["walkthrough_id"]; isOneToOne: false; referencedRelation: "walkthroughs"; referencedColumns: ["id"] },
      ] };
      proposal_history: { Row: ProposalHistory; Insert: Omit<ProposalHistory, "id" | "created_at"> & { id?: string; created_at?: string }; Update: never; Relationships: [{ foreignKeyName: "proposal_history_proposal_id_fkey"; columns: ["proposal_id"]; isOneToOne: false; referencedRelation: "proposals"; referencedColumns: ["id"] }] };
      jobs: { Row: Job; Insert: JobInsert & { id?: string; created_at?: string; updated_at?: string }; Update: JobUpdate; Relationships: [
        { foreignKeyName: "jobs_proposal_id_fkey"; columns: ["proposal_id"]; isOneToOne: false; referencedRelation: "proposals"; referencedColumns: ["id"] },
        { foreignKeyName: "jobs_estimate_id_fkey"; columns: ["estimate_id"]; isOneToOne: false; referencedRelation: "estimates"; referencedColumns: ["id"] },
        { foreignKeyName: "jobs_walkthrough_id_fkey"; columns: ["walkthrough_id"]; isOneToOne: false; referencedRelation: "walkthroughs"; referencedColumns: ["id"] },
        { foreignKeyName: "jobs_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
        { foreignKeyName: "jobs_property_id_fkey"; columns: ["property_id"]; isOneToOne: false; referencedRelation: "properties"; referencedColumns: ["id"] },
        { foreignKeyName: "jobs_assigned_crew_id_fkey"; columns: ["assigned_crew_id"]; isOneToOne: false; referencedRelation: "crews"; referencedColumns: ["id"] },
      ] };
      employees:{Row:Employee;Insert:EmployeeInput&{id?:string;employee_number:string;created_at?:string;updated_at?:string;archived_at?:string|null};Update:EmployeeUpdate;Relationships:[]};
      crews:{Row:Crew;Insert:CrewInput&{id?:string;created_at?:string;updated_at?:string;archived_at?:string|null};Update:CrewUpdate;Relationships:[{foreignKeyName:"crews_crew_lead_id_fkey";columns:["crew_lead_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]}]};
      crew_members:{Row:Omit<CrewMember,"employee">;Insert:{id?:string;crew_id:string;employee_id:string;created_at?:string};Update:never;Relationships:[{foreignKeyName:"crew_members_crew_id_fkey";columns:["crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]},{foreignKeyName:"crew_members_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]}]};
      invoices:{Row:Invoice;Insert:Omit<Invoice,"id"|"created_at"|"updated_at"|"archived_at"|"sent_at"|"paid_at">&{id?:string;created_at?:string;updated_at?:string;archived_at?:string|null;sent_at?:string|null;paid_at?:string|null};Update:InvoiceUpdate;Relationships:[{foreignKeyName:"invoices_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"invoices_proposal_id_fkey";columns:["proposal_id"];isOneToOne:false;referencedRelation:"proposals";referencedColumns:["id"]},{foreignKeyName:"invoices_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"invoices_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]}]};
      payments:{Row:Payment;Insert:PaymentInsert&{id?:string;created_at?:string};Update:never;Relationships:[{foreignKeyName:"payments_invoice_id_fkey";columns:["invoice_id"];isOneToOne:false;referencedRelation:"invoices";referencedColumns:["id"]},{foreignKeyName:"payments_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"payments_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]}]};
      expenses:{Row:Expense;Insert:ExpenseInput&{id?:string;expense_number:string;status?:"Active";receipt_url?:string|null;created_at?:string;updated_at?:string;archived_at?:string|null};Update:ExpenseUpdate;Relationships:[{foreignKeyName:"expenses_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"expenses_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]},{foreignKeyName:"expenses_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"expenses_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]}]};
      vehicles:{Row:Vehicle;Insert:VehicleInput&{id?:string;vehicle_number:string;created_at?:string;updated_at?:string;archived_at?:string|null};Update:VehicleUpdate;Relationships:[{foreignKeyName:"vehicles_assigned_employee_id_fkey";columns:["assigned_employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]},{foreignKeyName:"vehicles_assigned_crew_id_fkey";columns:["assigned_crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]}]};
      mileage_entries:{Row:MileageEntry;Insert:MileageInput&{id?:string;mileage_number:string;deductible_amount:number;status?:"Active";created_at?:string;updated_at?:string;archived_at?:string|null};Update:MileageUpdate;Relationships:[{foreignKeyName:"mileage_entries_vehicle_id_fkey";columns:["vehicle_id"];isOneToOne:false;referencedRelation:"vehicles";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_crew_id_fkey";columns:["crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]}]};
      time_entries:{Row:TimeEntry;Insert:TimeEntryInput&{id?:string;time_entry_number:string;status?:"Open"|"Completed";regular_hours?:number;overtime_hours?:number;total_hours?:number;hourly_rate_snapshot?:number;overtime_rate_snapshot?:number;regular_pay?:number;overtime_pay?:number;gross_pay?:number;approved_at?:string|null;approved_by?:string|null;created_at?:string;updated_at?:string;archived_at?:string|null};Update:TimeEntryUpdate;Relationships:[{foreignKeyName:"time_entries_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]},{foreignKeyName:"time_entries_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"time_entries_crew_id_fkey";columns:["crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]}]};
      service_agreements:{Row:ServiceAgreement;Insert:AgreementInput&{agreement_number:string};Update:AgreementUpdate;Relationships:[]};
      service_occurrences:{Row:ServiceOccurrence;Insert:Omit<ServiceOccurrence,"id"|"job_id"|"created_at"|"updated_at"|"notes">&{job_id?:string|null;notes?:string|null};Update:Partial<ServiceOccurrence>;Relationships:[]};
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
