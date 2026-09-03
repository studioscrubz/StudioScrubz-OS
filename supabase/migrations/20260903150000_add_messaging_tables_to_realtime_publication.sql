-- Add internal messaging tables (Direct Messages, Slice 2A) to the existing
-- Postgres Changes publication; existing RLS policies continue to govern rows.
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Required publication supabase_realtime does not exist';
  end if;

  foreach v_table in array array[
    'conversations', 'conversation_members', 'messages', 'message_read_states'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$$;
