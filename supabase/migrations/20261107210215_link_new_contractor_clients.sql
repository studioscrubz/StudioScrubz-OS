-- Save the Accounts client and its portal company link in the same transaction.
create function private.link_new_contractor_client()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
 v_name text := lower(btrim(new.name));
 v_email text := lower(btrim(new.contact_email));
 v_contact text := regexp_replace(btrim(new.contact_name),'[[:space:]]+',' ','g');
 v_client public.clients%rowtype;
 v_match_count integer;
begin
 if new.client_id is not null then return new; end if;

 -- Serialize portal creates for the same company name, including retries.
 perform pg_advisory_xact_lock(hashtextextended('contractor-client:'||v_name,0));
 select count(*) into v_match_count from public.clients c
 where c.client_type='Contractor' and c.archived_at is null and lower(btrim(c.company_name))=v_name;
 if v_match_count>1 then
  raise exception 'Multiple Contractor clients have this company name. Resolve the duplicates in Accounts first.';
 end if;
 if v_match_count=1 then
  select * into strict v_client from public.clients c
  where c.client_type='Contractor' and c.archived_at is null and lower(btrim(c.company_name))=v_name
  for update;
  if nullif(lower(btrim(v_client.email)),'') is not null and lower(btrim(v_client.email))<>v_email then
   raise exception 'A Contractor client already uses this company name with a different email. Verify the Accounts contact email first.';
  end if;
  if exists(select 1 from public.contractor_companies c where c.client_id=v_client.id) then
   raise exception 'This Contractor client already has a portal company.';
  end if;
  new.client_id:=v_client.id;
 else
  insert into public.clients(client_type,company_name,first_name,last_name,phone,email,status)
  values('Contractor',new.name,nullif(split_part(v_contact,' ',1),''),nullif(substr(v_contact,strpos(v_contact||' ',' ')+1),''),new.phone,new.contact_email,'Active')
  returning id into new.client_id;
 end if;
 return new;
end $$;

revoke all on function private.link_new_contractor_client() from public,anon,authenticated;
create trigger link_new_contractor_client
before insert on public.contractor_companies
for each row execute function private.link_new_contractor_client();
