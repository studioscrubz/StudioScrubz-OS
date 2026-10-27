\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);

do $$
begin
  begin
    perform public.complete_in_progress_job('30000000-0000-4000-8000-000000000001');
    raise exception 'Expected missing-photo rejection';
  exception when others then
    if sqlerrm <> 'Upload finished-job photos before ending this job.' then raise; end if;
  end;
end $$;

do $$
begin
  if (select status from public.jobs where id='30000000-0000-4000-8000-000000000001') <> 'In Progress' then
    raise exception 'Missing photo changed Job status';
  end if;
  if (select count(*) from public.time_entries where job_id='30000000-0000-4000-8000-000000000001' and status='Open' and clock_out is null) <> 2 then
    raise exception 'Missing photo clocked out crew members';
  end if;
end $$;

-- Metadata without its matching object represents a pending/failed/deleted upload.
reset role;
update public.jobs set photos=jsonb_build_array(jsonb_build_object(
  'id','50000000-0000-4000-8000-000000000001','storagePath','jobs/30000000-0000-4000-8000-000000000001/after/50000000-0000-4000-8000-000000000001.jpg',
  'category','After','mimeType','image/jpeg','sizeBytes',1024
)) where id='30000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);

do $$ begin
  begin perform public.complete_in_progress_job('30000000-0000-4000-8000-000000000001'); raise exception 'Expected missing-object rejection';
  exception when others then if sqlerrm <> 'Upload finished-job photos before ending this job.' then raise; end if; end;
end $$;

-- An object and metadata belonging to another Job must not satisfy this Job.
reset role;
insert into storage.objects(id,bucket_id,name) values(
 '60000000-0000-4000-8000-000000000001','operational-photos','jobs/30000000-0000-4000-8000-000000000002/after/50000000-0000-4000-8000-000000000001.jpg'
);
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);
do $$ begin
  begin perform public.complete_in_progress_job('30000000-0000-4000-8000-000000000001'); raise exception 'Expected unrelated-photo rejection';
  exception when others then if sqlerrm <> 'Upload finished-job photos before ending this job.' then raise; end if; end;
end $$;

reset role;
insert into storage.objects(id,bucket_id,name) values(
 '60000000-0000-4000-8000-000000000002','operational-photos','jobs/30000000-0000-4000-8000-000000000001/after/50000000-0000-4000-8000-000000000001.jpg'
);
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);
select public.complete_in_progress_job('30000000-0000-4000-8000-000000000001');

do $$
declare first_entry public.time_entries; late_entry public.time_entries;
begin
  select * into first_entry from public.time_entries where id='40000000-0000-4000-8000-000000000001';
  select * into late_entry from public.time_entries where id='40000000-0000-4000-8000-000000000002';
  if first_entry.status <> 'Completed' or late_entry.status <> 'Completed' or first_entry.clock_out is null then raise exception 'Crew was not clocked out'; end if;
  if first_entry.clock_out is distinct from late_entry.clock_out then raise exception 'Crew clock-out timestamps differ'; end if;
  if first_entry.clock_in <> '2026-10-26 15:00:00+00'::timestamptz or late_entry.clock_in <> '2026-10-26 15:30:00+00'::timestamptz then raise exception 'Clock-in timestamps changed'; end if;
  if (select status from public.jobs where id='30000000-0000-4000-8000-000000000001') <> 'Completed' then raise exception 'Job was not completed'; end if;
end $$;

-- Alternate direct completion paths are blocked, while historical Completed rows remain untouched.
reset role;
do $$ begin
  begin update public.jobs set status='Completed' where id='30000000-0000-4000-8000-000000000003'; raise exception 'Expected trigger rejection';
  exception when others then if sqlerrm <> 'Upload finished-job photos before ending this job.' then raise; end if; end;
end $$;
update public.jobs set completed_at='2026-10-26 20:00:00+00' where id='30000000-0000-4000-8000-000000000004';

-- A technician cannot complete a Job outside their assignment even with valid evidence.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
do $$ begin
  begin perform public.complete_in_progress_job('30000000-0000-4000-8000-000000000002'); raise exception 'Expected authorization rejection';
  exception when others then if sqlerrm <> 'Job not found or access denied.' then raise; end if; end;
end $$;
