import type { Client, ClientInput } from "@/types/client";
import type { Property, PropertyInput } from "@/types/property";
import type { Estimate, EstimateInsert, EstimateUpdate } from "@/types/estimate";
import type { Walkthrough, WalkthroughInput, WalkthroughUpdate } from "@/types/walkthrough";
import type { Proposal, ProposalHistory, ProposalInsert, ProposalUpdate } from "@/types/proposal";
import type { Job, JobInsert, JobUpdate } from "@/types/job";
import type { Employee, EmployeeInput, EmployeeUpdate } from "@/types/employee";
import type { Crew, CrewInput, CrewMember, CrewUpdate } from "@/types/crew";

export interface Database {
  public: {
    Tables: {
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
