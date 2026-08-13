import { EstimateBuilder } from "@/components/estimates/EstimateBuilder";

export default function Page() {
  return <><header className="mb-7 border-b border-[#143d1a]/10 pb-7 sm:mb-9 sm:pb-8"><p className="mb-3 text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Operations workspace</p><h1 className="text-3xl font-extrabold tracking-[-.04em] text-[#143d1a] sm:text-4xl">Estimate Calculator</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">Create residential and commercial service estimates.</p></header><EstimateBuilder /></>;
}
