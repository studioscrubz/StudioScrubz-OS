export type ProposalDepositStatus = "Required" | "Received" | "Reversed" | "Applied To Invoice";
export type ProposalDepositRequirement = {
  id:string; proposal_id:string; agreement_id:string|null; client_id:string|null; property_id:string|null;
  currency:string; deposit_percent:number; accepted_total:number; required_amount:number; remaining_balance:number;
  status:ProposalDepositStatus; payment_method:"Zelle"; recipient_name:string; recipient_phone:string; rendered_memo:string;
  instruction_version:number; received_payment_id:string|null; received_date:string|null; received_reference_number:string|null;
  received_notes:string|null; received_by:string|null; received_at:string|null; reversed_by:string|null; reversed_at:string|null;
  reversal_reason:string|null; applied_invoice_id:string|null; applied_at:string|null; created_at:string; updated_at:string;
};
export type ProposalDepositEvent = {id:string;requirement_id:string;event_type:"Required"|"Instructions Refreshed"|"Received"|"Reversed"|"Applied To Invoice";actor_user_id:string|null;metadata:Record<string,unknown>;created_at:string};
