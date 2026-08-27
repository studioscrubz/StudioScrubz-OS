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
import type {AuthorizedVehicle,Vehicle,VehicleInput,VehicleUpdate} from "@/types/vehicle";
import type {MileageEntry,MileageInput,MileageUpdate} from "@/types/mileage";
import type {TimeEntry,TimeEntryInput,TimeEntryUpdate} from "@/types/timeEntry";
import type {ServiceAgreement,AgreementInput,AgreementUpdate} from "@/types/agreement";
import type {ServiceOccurrence} from "@/types/serviceOccurrence";
import type {AgreementDocumentInsert,ServiceAgreementDocument} from "@/types/agreementDocument";
import type {UserProfile} from "@/types/auth";
import type {CatalogService,RecurringPricingRule,RecurringPricingRuleInput,ServiceAddon,ServiceAddonInput,ServiceAddonLink,ServiceInput,ServiceLabel,ServiceLabelAssignment,ServicePriceTier,ServicePriceTierInput} from "@/types/serviceCatalog";
import type {BusinessIdentitySettings,BusinessSettings,BusinessSettingsUpdate} from "@/types/businessSettings";
import type {ClientCommunication,ClientCommunicationInput} from "@/types/clientCommunication";
import type {AttentionStateRecord} from "@/types/attention";
import type {PublicEstimate} from "@/types/publicEstimate";
import type {PublicProposal} from "@/types/publicProposal";
import type {InvoiceJobPhoto} from "@/types/photo";
import type {ActiveEmployeeWorkSession,EmployeeWorkSession} from "@/types/workSession";

export interface Database {
  public: {
    Tables: {
      user_profiles:{Row:UserProfile;Insert:UserProfile;Update:Partial<Pick<UserProfile,"display_name"|"role"|"is_active"|"employee_id">>;Relationships:[{foreignKeyName:"user_profiles_employee_id_fkey";columns:["employee_id"];isOneToOne:true;referencedRelation:"employees";referencedColumns:["id"]}]};
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
        Update: WalkthroughUpdate & Partial<Pick<Walkthrough, "pricing_review" | "pricing_reviewed_at" | "pricing_reviewed_by">>;
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
      invoices:{Row:Invoice;Insert:Omit<Invoice,"id"|"created_at"|"updated_at"|"archived_at"|"sent_at"|"paid_at"|"client_access_token"|"client_access_token_expires_at"|"customer_notes">&{id?:string;created_at?:string;updated_at?:string;archived_at?:string|null;sent_at?:string|null;paid_at?:string|null;client_access_token?:string|null;client_access_token_expires_at?:string|null;customer_notes?:string|null};Update:InvoiceUpdate;Relationships:[{foreignKeyName:"invoices_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"invoices_proposal_id_fkey";columns:["proposal_id"];isOneToOne:false;referencedRelation:"proposals";referencedColumns:["id"]},{foreignKeyName:"invoices_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"invoices_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]}]};
      invoice_job_photos:{Row:InvoiceJobPhoto;Insert:Omit<InvoiceJobPhoto,"id"|"created_at">&{id?:string;created_at?:string};Update:Pick<InvoiceJobPhoto,"customer_visible">;Relationships:[{foreignKeyName:"invoice_job_photos_invoice_id_fkey";columns:["invoice_id"];isOneToOne:false;referencedRelation:"invoices";referencedColumns:["id"]},{foreignKeyName:"invoice_job_photos_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]}]};
      payments:{Row:Payment;Insert:PaymentInsert&{id?:string;created_at?:string};Update:never;Relationships:[{foreignKeyName:"payments_invoice_id_fkey";columns:["invoice_id"];isOneToOne:false;referencedRelation:"invoices";referencedColumns:["id"]},{foreignKeyName:"payments_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"payments_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]}]};
      expenses:{Row:Expense;Insert:ExpenseInput&{id?:string;expense_number:string;status?:"Active";receipt_url?:string|null;created_at?:string;updated_at?:string;archived_at?:string|null};Update:ExpenseUpdate;Relationships:[{foreignKeyName:"expenses_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"expenses_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]},{foreignKeyName:"expenses_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"expenses_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]}]};
      vehicles:{Row:Vehicle;Insert:VehicleInput&{id?:string;vehicle_number:string;created_at?:string;updated_at?:string;archived_at?:string|null};Update:VehicleUpdate;Relationships:[{foreignKeyName:"vehicles_assigned_employee_id_fkey";columns:["assigned_employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]},{foreignKeyName:"vehicles_assigned_crew_id_fkey";columns:["assigned_crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]}]};
      mileage_entries:{Row:MileageEntry;Insert:MileageInput&{id?:string;mileage_number:string;deductible_amount:number;status?:"Active";created_at?:string;updated_at?:string;archived_at?:string|null};Update:MileageUpdate;Relationships:[{foreignKeyName:"mileage_entries_vehicle_id_fkey";columns:["vehicle_id"];isOneToOne:false;referencedRelation:"vehicles";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_crew_id_fkey";columns:["crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"mileage_entries_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]}]};
      time_entries:{Row:TimeEntry;Insert:TimeEntryInput&{id?:string;time_entry_number:string;status?:"Open"|"Completed";regular_hours?:number;overtime_hours?:number;total_hours?:number;hourly_rate_snapshot?:number;overtime_rate_snapshot?:number;regular_pay?:number;overtime_pay?:number;gross_pay?:number;approved_at?:string|null;approved_by?:string|null;created_at?:string;updated_at?:string;archived_at?:string|null};Update:TimeEntryUpdate;Relationships:[{foreignKeyName:"time_entries_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]},{foreignKeyName:"time_entries_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]},{foreignKeyName:"time_entries_crew_id_fkey";columns:["crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]}]};
      employee_work_sessions:{Row:EmployeeWorkSession;Insert:{id?:string;employee_id:string;clock_in?:string;clock_out?:string|null;status?:EmployeeWorkSession["status"];created_at?:string;updated_at?:string};Update:Partial<Pick<EmployeeWorkSession,"clock_out"|"status"|"updated_at">>;Relationships:[{foreignKeyName:"employee_work_sessions_employee_id_fkey";columns:["employee_id"];isOneToOne:false;referencedRelation:"employees";referencedColumns:["id"]}]};
      service_agreements:{Row:ServiceAgreement;Insert:AgreementInput&{agreement_number:string};Update:AgreementUpdate;Relationships:[{foreignKeyName:"service_agreements_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"service_agreements_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]},{foreignKeyName:"service_agreements_proposal_id_fkey";columns:["proposal_id"];isOneToOne:false;referencedRelation:"proposals";referencedColumns:["id"]},{foreignKeyName:"service_agreements_assigned_crew_id_fkey";columns:["assigned_crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]}]};
      service_agreement_documents:{Row:ServiceAgreementDocument;Insert:AgreementDocumentInsert;Update:Partial<Pick<ServiceAgreementDocument,"document_name"|"description"|"archived_at">>;Relationships:[{foreignKeyName:"service_agreement_documents_agreement_id_fkey";columns:["agreement_id"];isOneToOne:false;referencedRelation:"service_agreements";referencedColumns:["id"]},{foreignKeyName:"service_agreement_documents_uploaded_by_fkey";columns:["uploaded_by"];isOneToOne:false;referencedRelation:"user_profiles";referencedColumns:["id"]}]};
      service_occurrences:{Row:ServiceOccurrence;Insert:Omit<ServiceOccurrence,"id"|"job_id"|"created_at"|"updated_at"|"notes">&{job_id?:string|null;notes?:string|null};Update:Partial<ServiceOccurrence>;Relationships:[{foreignKeyName:"service_occurrences_agreement_id_fkey";columns:["agreement_id"];isOneToOne:false;referencedRelation:"service_agreements";referencedColumns:["id"]},{foreignKeyName:"service_occurrences_assigned_crew_id_fkey";columns:["assigned_crew_id"];isOneToOne:false;referencedRelation:"crews";referencedColumns:["id"]},{foreignKeyName:"service_occurrences_job_id_fkey";columns:["job_id"];isOneToOne:false;referencedRelation:"jobs";referencedColumns:["id"]}]};
      services:{Row:CatalogService;Insert:ServiceInput;Update:Partial<ServiceInput>&{archived_at?:string|null};Relationships:[]};
      service_price_tiers:{Row:ServicePriceTier;Insert:ServicePriceTierInput;Update:Partial<ServicePriceTierInput>;Relationships:[{foreignKeyName:"service_price_tiers_service_id_fkey";columns:["service_id"];isOneToOne:false;referencedRelation:"services";referencedColumns:["id"]}]};
      service_addons:{Row:ServiceAddon;Insert:ServiceAddonInput;Update:Partial<ServiceAddonInput>&{archived_at?:string|null};Relationships:[]};
      service_addon_links:{Row:ServiceAddonLink;Insert:ServiceAddonLink;Update:never;Relationships:[{foreignKeyName:"service_addon_links_service_id_fkey";columns:["service_id"];isOneToOne:false;referencedRelation:"services";referencedColumns:["id"]},{foreignKeyName:"service_addon_links_addon_id_fkey";columns:["addon_id"];isOneToOne:false;referencedRelation:"service_addons";referencedColumns:["id"]}]};
      service_labels:{Row:ServiceLabel;Insert:{id?:string;name:string;created_at?:string;updated_at?:string};Update:{name?:string;updated_at?:string};Relationships:[]};
      service_label_assignments:{Row:ServiceLabelAssignment;Insert:{service_id:string;label_id:string;created_at?:string};Update:never;Relationships:[{foreignKeyName:"service_label_assignments_service_id_fkey";columns:["service_id"];isOneToOne:false;referencedRelation:"services";referencedColumns:["id"]},{foreignKeyName:"service_label_assignments_label_id_fkey";columns:["label_id"];isOneToOne:false;referencedRelation:"service_labels";referencedColumns:["id"]}]};
      recurring_pricing_rules:{Row:RecurringPricingRule;Insert:RecurringPricingRuleInput;Update:Partial<RecurringPricingRuleInput>;Relationships:[{foreignKeyName:"recurring_pricing_rules_service_id_fkey";columns:["service_id"];isOneToOne:false;referencedRelation:"services";referencedColumns:["id"]}]};
      business_settings:{Row:BusinessSettings;Insert:BusinessSettingsUpdate&{id?:string};Update:Partial<BusinessSettingsUpdate>;Relationships:[]};
      client_communications:{Row:ClientCommunication;Insert:ClientCommunicationInput&{id?:string;communication_number:string;created_at?:string;updated_at?:string;archived_at?:string|null};Update:Partial<ClientCommunication>;Relationships:[{foreignKeyName:"client_communications_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"clients";referencedColumns:["id"]},{foreignKeyName:"client_communications_property_id_fkey";columns:["property_id"];isOneToOne:false;referencedRelation:"properties";referencedColumns:["id"]},{foreignKeyName:"client_communications_estimate_id_fkey";columns:["estimate_id"];isOneToOne:false;referencedRelation:"estimates";referencedColumns:["id"]},{foreignKeyName:"client_communications_proposal_id_fkey";columns:["proposal_id"];isOneToOne:false;referencedRelation:"proposals";referencedColumns:["id"]},{foreignKeyName:"client_communications_agreement_id_fkey";columns:["agreement_id"];isOneToOne:false;referencedRelation:"service_agreements";referencedColumns:["id"]},{foreignKeyName:"client_communications_invoice_id_fkey";columns:["invoice_id"];isOneToOne:false;referencedRelation:"invoices";referencedColumns:["id"]},{foreignKeyName:"client_communications_sent_by_user_id_fkey";columns:["sent_by_user_id"];isOneToOne:false;referencedRelation:"user_profiles";referencedColumns:["id"]}]};
      attention_item_states:{Row:AttentionStateRecord;Insert:{id?:string;user_id:string;attention_key:string;state:AttentionStateRecord["state"];snoozed_until?:string|null;dismissed_at?:string|null;created_at?:string;updated_at?:string};Update:Partial<Pick<AttentionStateRecord,"state"|"snoozed_until"|"dismissed_at">>;Relationships:[{foreignKeyName:"attention_item_states_user_id_fkey";columns:["user_id"];isOneToOne:false;referencedRelation:"user_profiles";referencedColumns:["id"]}]};
    };
    Views: {
      jobs_operational_safe:{Row:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">;Relationships:[]};
      employee_directory_safe:{Row:Omit<Employee,"hourly_rate"|"overtime_rate"|"commission_rate">;Relationships:[]};
      employee_directory_sales_safe:{Row:Omit<Employee,"hourly_rate"|"overtime_rate"|"commission_rate"|"hire_date"|"notes">;Relationships:[]};
      authorized_vehicles_safe:{Row:AuthorizedVehicle;Relationships:[]};
      time_entries_operational_safe:{Row:Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null};Relationships:[]};
      crew_directory_safe:{Row:Crew;Relationships:[]};
      crew_members_directory_safe:{Row:{id:string;crew_id:string;employee_id:string;created_at:string;employee_number:string;first_name:string;last_name:string;preferred_name:string|null;email:string|null;phone:string|null;department:string;job_title:string|null;employment_status:string;employment_type:string|null;hire_date:string|null;notes:string|null;employee_created_at:string;employee_updated_at:string;employee_archived_at:string|null};Relationships:[]};
      business_settings_public:{Row:BusinessIdentitySettings;Relationships:[]};
      business_settings_workflow:{Row:BusinessSettings;Relationships:[]};
    };
    Functions: {
      get_or_create_service_label:{Args:{p_name:string};Returns:ServiceLabel};
      get_business_settings_public:{Args:Record<string,never>;Returns:BusinessIdentitySettings[]};
      get_business_settings_workflow:{Args:Record<string,never>;Returns:BusinessSettings[]};
      get_employee_directory:{Args:Record<string,never>;Returns:Array<Omit<Employee,"hourly_rate"|"overtime_rate"|"commission_rate">>};
      get_crew_directory:{Args:Record<string,never>;Returns:Crew[]};
      get_crew_members_directory:{Args:Record<string,never>;Returns:Array<{id:string;crew_id:string;employee_id:string;created_at:string;employee_number:string;first_name:string;last_name:string;preferred_name:string|null;email:string|null;phone:string|null;department:string;job_title:string|null;employment_status:string;employment_type:string|null;hire_date:string|null;notes:string|null;employee_created_at:string;employee_updated_at:string;employee_archived_at:string|null}>};
      get_operational_time_entries:{Args:Record<string,never>;Returns:Array<Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null}>};
      start_my_work:{Args:Record<string,never>;Returns:EmployeeWorkSession};
      stop_my_work:{Args:Record<string,never>;Returns:EmployeeWorkSession};
      get_my_work_session:{Args:Record<string,never>;Returns:EmployeeWorkSession|null};
      get_active_employee_work_sessions:{Args:Record<string,never>;Returns:ActiveEmployeeWorkSession[]};
      admin_create_user_profile:{Args:{p_auth_user_id:string;p_email:string;p_display_name:string;p_role:string;p_employee_id:string|null;p_is_active:boolean};Returns:UserProfile};
      admin_update_user_profile:{Args:{p_profile_id:string;p_display_name:string;p_role:string;p_employee_id:string|null;p_is_active:boolean};Returns:UserProfile};
      admin_set_user_active:{Args:{p_profile_id:string;p_is_active:boolean};Returns:UserProfile};
      get_operational_jobs:{Args:{p_start?:string|null;p_end?:string|null};Returns:Array<Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">>};
      get_operational_job_ids:{Args:{p_start?:string|null;p_end?:string|null};Returns:string[]};
      get_financially_handed_off_job_ids:{Args:Record<string,never>;Returns:string[]};
      create_job_from_accepted_proposal:{Args:{p_proposal_id:string};Returns:Job};
      create_direct_operational_job:{Args:{p_client_id:string;p_property_id:string;p_service_id:string;p_addon_ids?:string[];p_scheduled_date?:string|null;p_start_time?:string|null;p_estimated_duration?:number|null;p_assigned_crew_id?:string|null;p_labor_hours?:number;p_access_instructions?:string|null;p_internal_notes?:string|null;p_master_price_override?:number|null};Returns:Job};
      archive_operational_job:{Args:{p_job_id:string};Returns:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">};
      get_archived_operational_jobs:{Args:Record<string,never>;Returns:Array<Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">>};
      restore_archived_operational_job:{Args:{p_job_id:string};Returns:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">};
      start_operational_job:{Args:{p_job_id:string};Returns:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">};
      start_or_clock_in_to_job:{Args:{p_job_id:string};Returns:import("@/types/job").JobClockInResult};
      finish_job_and_clock_out:{Args:{p_job_id:string;p_break_minutes?:number};Returns:import("@/types/job").JobClockOutResult};
      complete_in_progress_job:{Args:{p_job_id:string};Returns:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">};
      update_operational_job:{Args:{p_job_id:string;p_scheduled_date?:string|null;p_start_time?:string|null;p_estimated_duration?:number|null;p_assigned_crew_id?:string|null;p_internal_notes?:string|null;p_status?:string|null};Returns:Omit<Job,"price"|"deposit"|"balance"|"labor_hours"|"recommended_crew_size"|"photos">};
      create_completed_job_invoice:{Args:{p_job_id:string};Returns:{invoice_id:string|null;invoice_number:string|null;created:boolean;skipped:boolean;financially_resolved?:boolean}};
      create_contract_agreement_invoice:{Args:{p_agreement_id:string;p_billing_period_start?:string|null;p_flat_contract_amount?:number|null};Returns:Invoice};
      create_job_from_service_occurrence:{Args:{p_occurrence_id:string};Returns:Job};
      record_invoice_payment:{Args:{p_invoice_id:string;p_amount:number;p_payment_date:string;p_payment_method:string;p_reference_number?:string|null;p_notes?:string|null};Returns:Payment};
      clock_in_operational:{Args:{p_employee_id:string;p_job_id:string|null;p_crew_id:string|null;p_entry_type:string;p_clock_in:string;p_notes:string|null};Returns:Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null}};
      clock_out_operational:{Args:{p_time_entry_id:string;p_clock_out:string;p_break_minutes:number};Returns:Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null}};
      save_operational_time_entry:{Args:{p_time_entry_id:string|null;p_employee_id:string;p_job_id:string|null;p_crew_id:string|null;p_entry_type:string;p_clock_in:string;p_clock_out:string|null;p_break_minutes:number;p_notes:string|null};Returns:Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null}};
      review_operational_time_entry:{Args:{p_time_entry_id:string;p_status:string;p_notes?:string|null};Returns:Omit<TimeEntry,"hourly_rate_snapshot"|"overtime_rate_snapshot"|"regular_pay"|"overtime_pay"|"gross_pay">&{employee_number:string;employee_name:string;job_number:string|null;crew_name:string|null}};
      admin_operational_create_employee:{Args:{p_employee_number:string;p_first_name:string;p_last_name:string;p_preferred_name:string|null;p_email:string|null;p_phone:string|null;p_department:string;p_job_title:string|null;p_employment_status:string;p_employment_type:string|null;p_hire_date:string|null;p_notes:string|null};Returns:Omit<Employee,"hourly_rate"|"overtime_rate"|"commission_rate">};
      admin_operational_update_employee:{Args:{p_employee_id:string;p_first_name:string;p_last_name:string;p_preferred_name:string|null;p_email:string|null;p_phone:string|null;p_department:string;p_job_title:string|null;p_employment_status:string;p_employment_type:string|null;p_hire_date:string|null;p_notes:string|null;p_archive?:boolean};Returns:Omit<Employee,"hourly_rate"|"overtime_rate"|"commission_rate">};
      manage_operational_crew:{Args:{p_crew_id:string|null;p_crew_name:string;p_crew_lead_id:string|null;p_status:string;p_notes:string|null;p_archive?:boolean};Returns:Crew};
      add_operational_crew_member:{Args:{p_crew_id:string;p_employee_id:string};Returns:string};
      remove_operational_crew_member:{Args:{p_member_id:string};Returns:undefined};
      master_admin_permanently_delete_archived_record:{Args:{p_record_type:string;p_record_id:string};Returns:string};
      master_admin_permanently_delete_cancelled_job:{Args:{p_job_id:string};Returns:string};
      get_service_agreement_by_token:{Args:{p_token:string};Returns:import("@/types/publicAgreement").PublicAgreement};
      accept_service_agreement_by_token:{Args:{p_token:string;p_signed_name:string;p_signature:string;p_consent:boolean};Returns:import("@/types/publicAgreement").PublicAgreement};
      get_estimate_by_token:{Args:{p_token:string};Returns:PublicEstimate};
      request_estimate_walkthrough_by_token:{Args:{p_token:string;p_client_name:string;p_email:string|null;p_phone:string|null;p_preferred_contact_method:string};Returns:import("@/types/publicEstimate").PublicEstimateWalkthroughRequestResult};
      get_proposal_by_token:{Args:{p_token:string};Returns:PublicProposal};
      get_invoice_by_token:{Args:{p_token:string};Returns:import("@/types/publicInvoice").PublicInvoice};
      get_invoice_payment_confirmation_by_token:{Args:{p_token:string};Returns:string|null};
      accept_proposal_by_token:{Args:{p_token:string;p_accepted_by_name:string;p_consent:boolean};Returns:PublicProposal};
      mark_estimate_sent_for_delivery:{Args:{p_estimate_id:string;p_recipient:string;p_sender:string;p_token:string;p_token_expires_at:string;p_snapshot:Record<string,unknown>};Returns:{sent_at:string}};
      mark_proposal_sent_for_delivery:{Args:{p_proposal_id:string;p_via:string;p_recipient:string;p_sender:string;p_token:string;p_token_expires_at:string;p_snapshot:Record<string,unknown>};Returns:{sent_at:string}};
      get_operational_photos:{Args:{p_record_type:string;p_record_id:string};Returns:import("@/types/photo").OperationalPhoto[]};
      set_operational_photos:{Args:{p_record_type:string;p_record_id:string;p_photos:import("@/types/photo").OperationalPhoto[]};Returns:import("@/types/photo").OperationalPhoto[]};
      get_proposal_pricing_photos:{Args:{p_proposal_id:string};Returns:import("@/types/proposal").ProposalPricingPhoto[]};
      add_proposal_owned_photo:{Args:{p_proposal_id:string;p_photo_id:string;p_storage_path:string;p_original_filename:string;p_caption:string;p_source:"camera"|"library"};Returns:import("@/types/proposal").ProposalPricingPhoto};
      set_proposal_pricing_photo_caption:{Args:{p_proposal_id:string;p_photo_id:string;p_caption:string};Returns:import("@/types/proposal").ProposalPricingPhoto[]};
      remove_proposal_pricing_photo:{Args:{p_proposal_id:string;p_photo_id:string};Returns:import("@/types/proposal").ProposalPricingPhotoRemoval};
      set_invoice_job_photo_visibility:{Args:{p_invoice_id:string;p_photo_id:string;p_customer_visible:boolean};Returns:InvoiceJobPhoto};
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
