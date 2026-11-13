CREATE OR REPLACE FUNCTION public.initiate_job_on_my_way(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.jobs; phone text; started timestamptz;
begin
 if auth.uid() is null or not public.has_any_role(array['Master Admin','Administrator','Manager','Crew Lead','Scrub Technician']) then raise exception 'On My Way access denied.'; end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or not public.can_access_job(j.id) then raise exception 'Job not found or access denied.'; end if;
 if j.archived_at is not null or j.status in ('Completed','Cancelled','Archived') or j.scheduled_date is null or j.start_time is null then raise exception 'This Job is not eligible for On My Way.'; end if;
 select c.phone into phone from public.clients c where c.id=j.client_id;
 if phone is null or length(regexp_replace(phone,'[^0-9]','','g')) not between 7 and 15 then return jsonb_build_object('initiated',false,'initiated_at',j.on_my_way_initiated_at); end if;
 if j.on_my_way_initiated_at is not null then return jsonb_build_object('initiated',false,'initiated_at',j.on_my_way_initiated_at); end if;
 update public.jobs set on_my_way_initiated_at=now() where id=j.id and on_my_way_initiated_at is null returning on_my_way_initiated_at into started;
 return jsonb_build_object('initiated',true,'initiated_at',started);
end $function$;
