"use client";
import { useEffect, useState } from "react";
import { getCurrentPosition } from "@/lib/geo/currentPosition";
import { getSupabaseClient } from "@/lib/supabase/client";

type Status = { configured: boolean; linked: boolean; radiusMeters?: number | null };
export function WalkthroughGpsCapture({ walkthroughId, readOnly }: { walkthroughId: string; readOnly: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [radius, setRadius] = useState(250);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const { data, error } = await getSupabaseClient().rpc("get_walkthrough_jobsite_gps" as never, { p_walkthrough_id: walkthroughId } as never);
    if (error) throw error;
    setStatus(data as unknown as Status);
  }
  useEffect(() => { void refresh().catch(e => setError(e instanceof Error ? e.message : "GPS unavailable")); }, [walkthroughId]);
  async function capture() {
    if (!window.confirm("Capture this property's GPS reference from your current onsite position?")) return;
    setBusy(true); setError("");
    try {
      const position = await getCurrentPosition();
      const { error } = await getSupabaseClient().rpc("capture_walkthrough_jobsite_gps" as never, { p_walkthrough_id: walkthroughId, p_position: position, p_radius_meters: radius } as never);
      if (error) throw error;
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "GPS capture failed"); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 rounded-xl border border-[#143d1a]/20 bg-[#f6f8f5] p-4" aria-label="Property GPS reference">
    <h3 className="font-bold text-[#143d1a]">Property GPS Reference</h3>
    <p className="mt-1 text-xs text-neutral-600">Save the property's location while physically onsite. One-time capture only; no background tracking.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {!status ? <p className="mt-2 text-sm">Checking GPS registration…</p> : status.configured ?
      <p className="mt-2 font-semibold text-green-800">GPS registered · {status.radiusMeters} meter radius. Future jobs reuse this reference.</p> :
      !status.linked ? <p className="mt-2 text-sm">This walkthrough has no linked property. Contact management to link it before GPS capture.</p> :
      readOnly ? <p className="mt-2 text-sm">GPS reference not registered. An assigned authorized technician must open the editable walkthrough onsite.</p> :
      <div className="mt-3">
        <label className="block text-sm font-semibold">Allowed arrival radius
          <select className="mt-1 block rounded border px-3 py-2" value={radius} onChange={e => setRadius(Number(e.target.value))}>
            {[150,250,350,500].map(x => <option key={x} value={x}>{x} meters</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} className="mt-3 rounded-lg bg-[#143d1a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void capture()}>
          {busy ? "Saving GPS…" : "Capture Property GPS Location"}
        </button>
      </div>}
  </section>;
}
