create table private.vendor_packet_tax_identity (
 singleton boolean primary key default true check (singleton),
 ein text not null check (ein ~ '^[0-9]{2}-[0-9]{7}$')
);

revoke all on table private.vendor_packet_tax_identity from public, anon, authenticated;

create function public.get_vendor_packet_ein()
returns text language plpgsql stable security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' and (
  auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Sales'])
 ) then
  raise exception 'Vendor packet access denied.' using errcode='42501';
 end if;
 return (select ein from private.vendor_packet_tax_identity where singleton);
end;
$$;
revoke all on function public.get_vendor_packet_ein() from public, anon, authenticated;
grant execute on function public.get_vendor_packet_ein() to authenticated, service_role;
