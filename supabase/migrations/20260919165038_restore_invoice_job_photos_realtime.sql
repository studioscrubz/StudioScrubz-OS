-- The invoice UI subscribes to all changes on invoice_job_photos so that
-- finished-photo visibility and snapshot changes refresh without a page load.
-- Publication membership is independent of table privileges and RLS.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'invoice_job_photos'
  ) then
    alter publication supabase_realtime
      add table public.invoice_job_photos;
  end if;
end
$$;
