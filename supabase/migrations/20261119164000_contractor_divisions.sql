begin;

alter table public.contractor_companies
 add column if not exists contractor_division text not null default 'Residential';

alter table public.contractor_companies
 drop constraint if exists contractor_companies_division_check;
alter table public.contractor_companies
 add constraint contractor_companies_division_check
 check (contractor_division in ('Residential','Commercial'));

update public.contractor_companies
 set contractor_division='Commercial',updated_at=now()
 where id='0ddb8c63-4c5d-4082-93df-9c9b0e105dfa';
update public.contractor_companies
 set contractor_division='Residential',updated_at=now()
 where id in ('a1b0e01c-3990-47e8-9c4f-40c772ce35fd','ee489374-42ce-4134-bee6-190d86be8edd');

commit;
