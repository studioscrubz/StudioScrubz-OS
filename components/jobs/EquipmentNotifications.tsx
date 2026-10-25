"use client";
import {useEffect,useState} from "react";
import {acknowledgeEquipmentHandoff,getMyEquipmentNotifications,type EquipmentNotification} from "@/lib/services/equipmentAccountability";
export function EquipmentNotifications(){
 const [items,setItems]=useState<EquipmentNotification[]>([]);
 const [error,setError]=useState<string|null>(null);
 const refresh=()=>getMyEquipmentNotifications().then(setItems).catch(e=>setError(e instanceof Error?e.message:"Equipment notices unavailable."));
 useEffect(()=>{let active=true;getMyEquipmentNotifications().then(rows=>{if(active)setItems(rows)}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Equipment notices unavailable.")});return()=>{active=false}},[]);
 if(!items.length && !error)return null;
 return <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
 <h3 className="text-sm font-bold text-amber-950">Equipment Notices</h3>
 {items.map(item=><div key={item.id} className="mt-2 rounded-lg bg-white p-2 text-xs">
 <p className="font-semibold">{item.event_type}</p><p>Client: {item.details.clientName?.trim() || "Not specified"}</p><p>Service Date: {item.details.serviceDate ? new Date(`${item.details.serviceDate}T12:00:00`).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}) : "Not scheduled"}</p>
 {item.event_type==="Equipment Handoff Pending" && item.details.handoff && <button type="button" className="mt-2 rounded bg-[#143d1a] px-2 py-1 font-bold text-white" onClick={async()=>{try{await acknowledgeEquipmentHandoff(item.details.handoff!);await refresh()}catch(e){setError(e instanceof Error?e.message:"Acknowledgment failed.")}}}>Acknowledge Receipt</button>}
 </div>)}
 {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
 </section>;
}
