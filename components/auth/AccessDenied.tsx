import Link from "next/link";

export function AccessDenied() {
  return (
    <main className="grid min-h-[70vh] place-items-center p-5">
      <section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#9a7a17]">Access denied</p>
        <h1 className="mt-3 text-2xl font-extrabold text-[#143d1a]">You do not have permission to access this area.</h1>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-[#143d1a] px-5 py-3 font-bold text-white">Return to Dashboard</Link>
      </section>
    </main>
  );
}
