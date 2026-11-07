-- Persist calculator-style address fields while retaining the existing request display address.
create or replace function private.save_contractor_request_property(p_request public.contractor_opportunities)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_company public.contractor_companies%rowtype; v_client uuid; v_property uuid;
 v_address jsonb := p_request.request_options->'address';
 v_street text := coalesce(v_address->>'street',p_request.property_address);
 v_line2 text := nullif(v_address->>'line2','');
 v_city text := v_address->>'city';
 v_state text := v_address->>'state';
 v_zip text := v_address->>'zip';
begin
 select * into strict v_company from public.contractor_companies where id=p_request.company_id for update;
 if v_company.status<>'Active' then raise exception 'Only active contractor companies may submit jobs.'; end if;
 v_client:=v_company.client_id;
 if v_client is null then
  insert into public.clients(client_type,company_name,phone,email,status)
  values('Contractor',v_company.name,v_company.phone,v_company.contact_email,'Active') returning id into v_client;
  update public.contractor_companies set client_id=v_client where id=v_company.id;
 end if;
 select id into v_property from public.properties
 where client_id=v_client and property_type=p_request.property_type and archived_at is null
   and lower(btrim(address))=lower(btrim(v_street))
   and (v_address is null or (
    lower(btrim(coalesce(address_line_2,'')))=lower(btrim(coalesce(v_line2,'')))
    and lower(btrim(coalesce(city,'')))=lower(btrim(coalesce(v_city,'')))
    and upper(btrim(coalesce(state,'')))=upper(btrim(coalesce(v_state,'')))
    and btrim(coalesce(zip,''))=btrim(coalesce(v_zip,''))))
 order by (id=p_request.request_property_id) desc nulls last,id limit 1;
 if v_property is null then
  insert into public.properties(client_id,property_type,property_name,address,address_line_2,city,state,zip,square_feet,bedrooms,bathrooms)
  values(v_client,p_request.property_type,p_request.property_name,v_street,v_line2,v_city,v_state,v_zip,p_request.square_feet,p_request.bedrooms,p_request.bathrooms)
  returning id into v_property;
 end if;
 return v_property;
end $$;
revoke all on function private.save_contractor_request_property(public.contractor_opportunities) from public,anon,authenticated;
