"use client";
import { contractorPage } from "@/lib/contractors/host";
import {useEffect,useState} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {getSupabaseClient} from "@/lib/supabase/client";
import {StudioScrubzLogo} from "@/components/branding/StudioScrubzLogo";
export function ContractorActivate(){
 const router=useRouter(),query=useSearchParams(),invitationParam=query.get("token");
 const [invitation,setInvitation]=useState<{companyName:string;email:string;expiresAt:string;token:string}|null>(null);
 const [password,setPassword]=useState(""),[loginPassword,setLoginPassword]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{
  const callback=new URL(window.location.href);
  // Supabase matches the exact allowed URL after removing the fragment.
  // Keep the invitation secret there for the email-confirmation round trip.
  const token=invitationParam??new URLSearchParams(callback.hash.slice(1)).get("token");
  if(callback.searchParams.has("code"))void getSupabaseClient().auth.getSession();
  if(!token)return;
  let alive=true;
  void fetch(`/api/contractors/invitations?token=${encodeURIComponent(token)}`,{cache:"no-store"}).then(async response=>{
   const body=await response.json();
   if(!response.ok)throw new Error(body.error??"Invitation unavailable");
   if(alive)setInvitation({...body,token});
  }).catch(e=>{if(alive)setError(e instanceof Error?e.message:"Invitation unavailable");});
  return()=>{alive=false;};
 },[invitationParam]);
 async function redeem(){
  if(!invitation)throw new Error("Open a valid invitation link to activate your account.");
  const response=await fetch("/api/contractors/invitations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"redeem",token:invitation.token})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??"Activation failed");
  const access=await fetch("/api/contractors/session",{cache:"no-store"});
  if(access.status===403){
   setInvitation(null);
   setNotice("Your invitation was redeemed. StudioScrubz Operations will need to activate the company before you can sign in.");
   await getSupabaseClient().auth.signOut({scope:"local"});
   return;
  }
  router.replace(contractorPage("/"));router.refresh();
 }
 async function create(e:React.FormEvent){
  e.preventDefault();if(!invitation)return;setBusy(true);setError("");setNotice("");
  try{
   if(password.length<12)throw new Error("Use a password of at least 12 characters.");
   const {data,error}=await getSupabaseClient().auth.signUp({
    email:invitation.email,password,
    options:{emailRedirectTo:`${process.env.NODE_ENV==="production"?"https://partners.studioscrubz.com":window.location.origin}/contractor/activate#token=${encodeURIComponent(invitation.token)}`},
   });
   if(error)throw error;
   if(data.session?.user){await redeem();return;}
   setNotice("Check your email to confirm the account, then return to this invitation link and sign in to activate.");
  }catch(e){setError(e instanceof Error?e.message:"Account setup failed");}finally{setBusy(false);}
 }
 async function existing(e:React.FormEvent){
  e.preventDefault();if(!invitation)return;setBusy(true);setError("");setNotice("");
  try{
   const {error}=await getSupabaseClient().auth.signInWithPassword({email:invitation.email,password:loginPassword});
   if(error)throw error;await redeem();
  }catch(e){setError(e instanceof Error?e.message:"Sign-in or activation failed.");}finally{setBusy(false);}
 }
 return <main className="grid min-h-screen place-items-center bg-[#f5f6f4] p-5"><section className="w-full max-w-lg rounded-2xl border bg-white p-7">
  <StudioScrubzLogo size={116} className="mx-auto"/>
  <h1 className="mt-3 text-center text-2xl font-extrabold text-[#143d1a]">Activate Contractor Access</h1>
  {invitation?<><p className="mt-4 text-center text-sm">Invited to <b>{invitation.companyName}</b> as <b>{invitation.email}</b></p>
   <p className="text-center text-xs text-neutral-500">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
   <form className="mt-6 space-y-3" onSubmit={create}><h2 className="font-bold">New account</h2>
    <label className="block text-sm">Create a secure password<input required minLength={12} type="password" autoComplete="new-password" className="mt-1 w-full rounded-lg border p-3" value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <button className="w-full rounded-lg bg-[#143d1a] p-3 font-bold text-white" disabled={busy}>Create account / activate</button></form>
   <form className="mt-5 space-y-3 border-t pt-5" onSubmit={existing}><h2 className="font-bold">Already have an account or confirmed your email?</h2>
    <label className="block text-sm">Password<input required type="password" autoComplete="current-password" className="mt-1 w-full rounded-lg border p-3" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)}/></label>
    <button className="w-full rounded-lg border border-[#143d1a] p-3 font-bold text-[#143d1a]" disabled={busy}>Sign in & redeem invitation</button></form>
  </>:<p className="mt-4 text-center text-sm">{(invitationParam||query.has("code"))&&!error&&!notice?"Verifying single-use invitation…":"Open a valid invitation link to activate your account."}</p>}
  {error&&<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
  {notice&&<p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-[#143d1a]">{notice}</p>}
 </section></main>;
}
