-- Master Admin is a valid prospect owner as well as an unrestricted prospect manager.
-- Preserve the existing security-definer functions and all other role restrictions.
do $$
declare fn text; signature text;
begin
  foreach signature in array array[
    'public.begin_prospect_discovery(uuid,text,integer,text,text,uuid)',
    'public.create_prospect_import_batch(uuid,text,integer,uuid)',
    'public.prepare_prospect_write()',
    'public.get_prospect_assignees()'
  ] loop
    fn := pg_get_functiondef(signature::regprocedure);
    fn := replace(fn, 'p.role=''Sales''', 'p.role in (''Sales'',''Master Admin'')');
    fn := replace(fn, 'profile.role = ''Sales''', 'profile.role in (''Sales'',''Master Admin'')');
    execute fn;
  end loop;
end $$;
