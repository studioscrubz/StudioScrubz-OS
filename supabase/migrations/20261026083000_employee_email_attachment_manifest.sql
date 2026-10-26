-- Preserve the exact file identity in each employee-email delivery for safe retries.
alter table public.employee_email_deliveries
 add column attachments_manifest jsonb not null default '[]'::jsonb
 constraint employee_email_attachments_manifest_format
 check (jsonb_typeof(attachments_manifest)='array' and jsonb_array_length(attachments_manifest) <= 3);
create function private.protect_employee_email_attachment_manifest()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.attachments_manifest is distinct from old.attachments_manifest then
  raise exception 'Employee email attachments are immutable after preparation.';
 end if;
 return new;
end;
$$;
create trigger protect_employee_email_attachment_manifest
before update on public.employee_email_deliveries
for each row execute function private.protect_employee_email_attachment_manifest();
revoke all on function private.protect_employee_email_attachment_manifest() from public, anon, authenticated;
