"use client";
import {useEffect,useState} from "react";
export default function OrientationInvite({token}:{token:string}){
 const [state,setState]=useState<{position:string;hourlyRate:number;minimumShiftHours:number;acknowledged:boolean}|null>(null);
 const [confirmed,setConfirmed]=useState(false);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState(false);
 useEffect(()=>{
  let active=true;
  void fetch("/api/onboarding/invite/"+encodeURIComponent(token),{cache:"no-store"})
   .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||"Unable to open invitation.");return data;})
   .then(data=>{if(active)setState(data);})
   .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[token]);
 async function acknowledge(){
  setSaving(true);setError("");
  try{
   const response=await fetch("/api/onboarding/invite/"+encodeURIComponent(token),
    {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acknowledgeTerms:confirmed})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||"Could not save confirmation.");
   setSuccess(true);
  }catch(e){setError(e instanceof Error?e.message:"Could not save confirmation.");}
  finally{setSaving(false);}
 }
 return <main className="mx-auto max-w-xl space-y-5 p-6">
  <h1 className="text-3xl font-extrabold text-[#143d1a]">Welcome to StudioScrubz</h1>
  <p>New Employee Orientation</p>
  {loading&&<p>Loading your invitation…</p>}
  {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
  {state&&<section className="rounded-2xl border bg-white p-5 space-y-4">
   <h2 className="font-bold text-lg">Position overview</h2>
   <p><strong>Role:</strong> {state.position}</p>
   <p><strong>Hourly pay:</strong> ${state.hourlyRate.toFixed(2)}</p>
   <p><strong>Employment:</strong> Part-time W-2, appointment-based schedule in the Long Beach area.</p>
   <p><strong>Company-guaranteed minimum:</strong> {state.minimumShiftHours} paid hours per scheduled shift (not per booking). Actual hours worked and paid training time must be recorded.</p>
   <p><strong>Supplies:</strong> StudioScrubz provides cleaning supplies and equipment.</p>
   <p><strong>Scheduling:</strong> Appointment volume and assigned hours may vary. Your manager will confirm your schedule and paid orientation.</p>
   <p className="text-sm text-neutral-600">Your manager will separately provide the complete offer letter, employee handbook, company policies, legally required notices and secure payroll/identity verification instructions. This page is not an I-9, tax, banking, or background-check submission portal. Do not upload or email sensitive documents here.</p>
   {state.acknowledged||success?
    <p role="status" className="rounded-lg bg-green-50 p-3 font-semibold text-green-900">Orientation overview acknowledgment recorded. Your hiring manager will contact you about the remaining steps.</p>
    :<>
      <label className="flex gap-3 text-sm">
       <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
       I have read the position overview displayed above and understand that the hiring team will provide the full required documents and training separately. This does not replace a signed employment offer or company-policy acknowledgments.
      </label>
      <button disabled={!confirmed||saving} className="rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white disabled:opacity-40" onClick={()=>void acknowledge()}>{saving?"Saving…":"Confirm orientation overview"}</button>
     </>}
  </section>}
 </main>;
}
