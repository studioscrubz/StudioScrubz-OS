create or replace function private.inventory_manager() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles p where p.id=auth.uid() and p.is_active and (p.role='Master Admin' or (p.role='Manager' and not exists(select 1 from public.employees e where e.id=p.employee_id and e.employment_type='1099'))))
$$;
