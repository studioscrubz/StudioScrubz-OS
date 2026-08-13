export function MetricCard({ label }: { label: string }) {
  return (
    <article className="rounded-2xl border border-[#143d1a]/10 bg-white p-5 shadow-[0_8px_25px_rgba(20,61,26,0.045)]">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-neutral-500">{label}</p>
        <span aria-hidden className="size-2 rounded-full bg-[#d4af37]" />
      </div>
      <p aria-label={`${label}: no data yet`} className="text-3xl font-extrabold text-[#143d1a]">—</p>
    </article>
  );
}
