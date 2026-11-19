import type {AgreementWithRelations} from "@/types/agreement";
import type {UserProfile} from "@/types/auth";
export function canEditContractorBilling(agreement: AgreementWithRelations|null,profile:UserProfile|null|undefined){
 return Boolean(agreement&&profile?.is_active&&profile.role==="Master Admin"
  &&["Active","Paused"].includes(agreement.status)&&agreement.client?.client_type==="Contractor"
  &&!agreement.proposal_id&&!agreement.signing_method&&!agreement.client_signed_at&&!agreement.representative_signature);
}
