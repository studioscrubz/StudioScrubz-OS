export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-7 border-b border-[#143d1a]/10 pb-7 sm:mb-9 sm:pb-8">
      <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#9a7a17]">Operations workspace</p>
      <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-[#143d1a] sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">{description}</p>
    </header>
  );
}
