import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendResendEmail } from "@/lib/email/resend";
import { getPublicSiteUrl } from "@/lib/publicSiteUrl";

type DepositRow={instruction_version:number;payment_method:string;recipient_name:string;recipient_phone:string;required_amount:number;currency:string;rendered_memo:string};
export async function sendPostConstructionDepositInstructions(input:{proposalToken?:string;proposalId?:string}) {
  const admin=createSupabaseAdminClient();
  let proposalQuery=admin.from("proposals").select("id,proposal_number,client_id,property_id,client_name,customer_email,client_access_token,status").eq("status","Accepted");
  proposalQuery=input.proposalId?proposalQuery.eq("id",input.proposalId):proposalQuery.eq("client_access_token",input.proposalToken??"");
  const{data:proposal,error:proposalError}=await proposalQuery.maybeSingle();if(proposalError)throw proposalError;if(!proposal)return{sent:false,reason:"Proposal not found"};
  const{data:deposit,error:depositError}=await admin.from("proposal_deposit_requirements").select("instruction_version,payment_method,recipient_name,recipient_phone,required_amount,currency,rendered_memo").eq("proposal_id",proposal.id).single();if(depositError)throw depositError;
  const d=deposit as DepositRow,eventKey=`proposal:${proposal.id}:deposit-instructions:${d.instruction_version}`,recipient=proposal.customer_email?.trim();
  if(!recipient||!/^\S+@\S+\.\S+$/.test(recipient))return{sent:false,reason:"No valid client email"};
  const{data:existing}=await admin.from("client_communications").select("id,status").eq("event_key",eventKey).maybeSingle();
  if(existing?.status==="Sent"||existing?.status==="Delivered"||existing?.status==="Opened")return{sent:false,reason:"Already sent"};
  const subject=`Deposit instructions for ${proposal.proposal_number}`;
  const phone=formatPhone(d.recipient_phone),amount=new Intl.NumberFormat("en-US",{style:"currency",currency:d.currency}).format(d.required_amount);
  const message=`Hello ${proposal.client_name||"Client"},\n\nThank you for accepting Proposal ${proposal.proposal_number}.\n\nRequired deposit: ${amount}\nPayment method: ${d.payment_method}\nRecipient: ${d.recipient_name}\nPhone: ${phone}\nMemo: ${d.rendered_memo}\n\nSending payment does not automatically confirm receipt. StudioScrubz staff will confirm the deposit after it is received.`;
  let communicationId=existing?.id;
  if(!communicationId){const{data:created,error}=await admin.from("client_communications").insert({communication_number:`COM-${Date.now()}-${crypto.randomUUID().slice(0,8)}`,client_id:proposal.client_id,property_id:proposal.property_id,proposal_id:proposal.id,communication_type:"Proposal",channel:"Email",direction:"Outbound",subject,message_body:message,recipient_email:recipient,status:"Prepared",provider:"Resend",metadata:{purpose:"deposit-instructions",instruction_version:d.instruction_version},event_key:eventKey}).select("id").single();if(error&&error.code!=="23505")throw error;communicationId=created?.id;if(!communicationId){const{data:race,error:raceError}=await admin.from("client_communications").select("id,status").eq("event_key",eventKey).single();if(raceError||!race)throw raceError??new Error("Communication history could not be prepared.");if(race.status==="Sent")return{sent:false,reason:"Already sent"};communicationId=race.id;}}
  try{const response=await sendResendEmail({recipientEmail:recipient,subject,text:`${message}\n\nView accepted Proposal:\n${getPublicSiteUrl()}/proposal/${proposal.client_access_token}`,html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2 style="color:#143d1a">StudioScrubz Deposit Instructions</h2>${message.split("\n").map(line=>`<div>${escapeHtml(line)||"&nbsp;"}</div>`).join("")}<p><a href="${getPublicSiteUrl()}/proposal/${proposal.client_access_token}">View accepted Proposal</a></p></div>`,idempotencyKey:eventKey,replyTo:"notifications@studioscrubz.com"});await admin.from("client_communications").update({status:"Sent",sent_at:new Date().toISOString(),provider_message_id:response.id,failure_reason:null}).eq("id",communicationId);return{sent:true};}
  catch(error){await admin.from("client_communications").update({status:"Failed",failure_reason:error instanceof Error?error.message:"Email delivery failed"}).eq("id",communicationId);throw error;}
}
const formatPhone=(value:string)=>value.length===10?`(${value.slice(0,3)}) ${value.slice(3,6)}-${value.slice(6)}`:value;
const escapeHtml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
