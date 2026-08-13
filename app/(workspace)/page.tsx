import { PageHeader } from "@/components/layout/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";

const metrics = ["Clients", "Properties", "Open Estimates", "Open Proposals", "Active Jobs", "Upcoming Walkthroughs"];

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="A clear view of StudioScrubz operations, all in one place." />
      <section aria-label="Business overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => <MetricCard key={metric} label={metric} />)}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <DashboardPlaceholder title="Recent Activity" message="Live activity will appear here when operational data is connected." />
        <DashboardPlaceholder title="Upcoming Schedule" message="Scheduled work and walkthroughs will appear here when live data is connected." />
      </section>
    </>
  );
}

function DashboardPlaceholder({ title, message }: { title: string; message: string }) {
  return (
    <article className="rounded-2xl border border-[#143d1a]/10 bg-white p-6 shadow-[0_8px_25px_rgba(20,61,26,0.045)]">
      <h2 className="text-base font-extrabold text-[#143d1a]">{title}</h2>
      <div className="mt-5 flex min-h-36 items-center justify-center rounded-xl border border-dashed border-[#143d1a]/15 bg-[#f8faf7] px-6 text-center">
        <p className="max-w-sm text-sm leading-6 text-neutral-500">{message}</p>
      </div>
    </article>
  );
}
