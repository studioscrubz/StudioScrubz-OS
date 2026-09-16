-- Integration regression suite for a DISPOSABLE database with all migrations applied.
-- Everything rolls back. Never run against production.
begin;

create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;

do $$
declare
  manager_user uuid:=gen_random_uuid(); worker_user uuid:=gen_random_uuid(); second_user uuid:=gen_random_uuid();
  manager_employee uuid:=gen_random_uuid(); worker_employee uuid:=gen_random_uuid(); second_employee uuid:=gen_random_uuid();
  crew_one uuid:=gen_random_uuid(); crew_two uuid:=gen_random_uuid(); client_id uuid:=gen_random_uuid(); property_id uuid:=gen_random_uuid(); plan_id uuid:=gen_random_uuid();
  visit_24 uuid; visit_1 uuid; visit_missed uuid; visit_null uuid; visit_started uuid; visit_completed uuid; visit_cancelled uuid; routed_visit uuid; route_id uuid;
  version timestamptz; revision_before bigint; resolved integer; count_rows integer; fixed_now timestamptz:='2030-01-01 12:00:00+00';
begin
  update public.business_settings set timezone='UTC';
  insert into auth.users(id,aud,role,email,created_at,updated_at) values
    (manager_user,'authenticated','authenticated',manager_user||'@example.invalid',now(),now()),
    (worker_user,'authenticated','authenticated',worker_user||'@example.invalid',now(),now()),
    (second_user,'authenticated','authenticated',second_user||'@example.invalid',now(),now());
  insert into public.employees(id,employee_number,first_name,last_name,department,employment_status) values
    (manager_employee,'PN-M','Porter','Manager','Management','Active'),
    (worker_employee,'PN-W','Porter','Worker','Scrub Technicians','Active'),
    (second_employee,'PN-S','Porter','Second','Scrub Technicians','Active');
  insert into public.user_profiles(id,email,display_name,role,is_active,employee_id) values
    (manager_user,manager_user||'@example.invalid','Manager','Manager',true,manager_employee),
    (worker_user,worker_user||'@example.invalid','Worker','Crew Lead',true,worker_employee),
    (second_user,second_user||'@example.invalid','Second','Scrub Technician',true,second_employee);
  insert into public.crews(id,crew_name,crew_lead_id,status) values
    (crew_one,'Notification Crew One',worker_employee,'Active'),
    (crew_two,'Notification Crew Two',second_employee,'Active');
  -- Duplicate lead/member membership must still resolve one user.
  insert into public.crew_members(crew_id,employee_id) values(crew_one,worker_employee),(crew_one,second_employee);
  select count(*) into count_rows from public.resolve_porter_notification_recipients(null,crew_one,null);
  perform pg_temp.assert_true(count_rows=2,'crew lead/member resolution is deduplicated');

  insert into public.clients(id,client_type,company_name) values(client_id,'Commercial','Notification Client');
  insert into public.properties(id,client_id,property_name,property_type,address) values(property_id,client_id,'Notification Property','Commercial','1 Test Lane');
  insert into public.property_service_plans(id,client_id,property_id,name,status,start_date,frequency,service_days,assigned_crew_id)
    values(plan_id,client_id,property_id,'Notification Plan','Active','2030-01-01','Weekly',array[1]::smallint[],crew_one);

  perform set_config('request.jwt.claim.sub',manager_user::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  visit_24:=public.create_porter_visit_v2(plan_id,'2030-01-02','12:00',crew_one,null);
  visit_1:=public.create_porter_visit_v2(plan_id,'2030-01-01','13:00',crew_one,null);
  visit_missed:=public.create_porter_visit_v2(plan_id,'2030-01-01','11:00',crew_one,null);
  routed_visit:=public.create_porter_visit_v2(plan_id,'2030-01-02','14:00',crew_one,null);
  route_id:=public.create_porter_route('2030-01-02',crew_one,'Test Route',null,jsonb_build_array(jsonb_build_object('visit_id',routed_visit)));
  execute 'reset role';

  -- Legacy/null-time visits remain valid and never receive timed notifications.
  insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,plan_name,property_label,scheduled_date)
    values(plan_id,client_id,property_id,crew_one,'Notification Plan','Null Time Property','2030-01-02') returning id into visit_null;
  perform pg_temp.assert_true((select scheduled_start_time is null and notification_revision=1 from public.property_service_visits where id=visit_null),'null-time legacy visit remains valid');

  -- Current membership is resolved when reminders become due, not when scheduled.
  delete from public.crew_members where crew_id=crew_one and employee_id=second_employee;
  resolved:=public.generate_due_porter_notifications(fixed_now);
  perform pg_temp.assert_true(resolved>0,'due generator produced events');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=visit_24 and event_type='visit_reminder_24h' and recipient_user_id=worker_user),'standalone 24-hour reminder');
  perform pg_temp.assert_true(not exists(select 1 from public.porter_notification_events where visit_id=visit_24 and event_type='visit_reminder_24h' and recipient_user_id=second_user),'removed current crew member receives no reminder');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=visit_1 and event_type='visit_reminder_1h'),'one-hour reminder');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=visit_missed and event_type='visit_missed_start' and recipient_user_id=worker_user),'worker missed-start alert');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=visit_missed and event_type='visit_missed_start' and recipient_user_id=manager_user),'management missed-start alert');
  perform pg_temp.assert_true(not exists(select 1 from public.porter_notification_events where visit_id=visit_null and event_type in ('visit_reminder_24h','visit_reminder_1h','visit_missed_start')),'null time has no timed events');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=routed_visit and event_type='visit_reminder_24h'),'routed visit reminder remains visit-based');

  -- Reassignment snapshots old/new recipients and advances the combined revision.
  select updated_at,notification_revision into version,revision_before from public.property_service_visits where id=visit_24;
  execute 'set local role authenticated';
  perform public.mutate_porter_visit(visit_24,version,'edit',jsonb_build_object('scheduled_date','2030-01-02','scheduled_start_time','12:30','assigned_crew_id',crew_two,'visit_notes',null));
  execute 'reset role';
  perform pg_temp.assert_true((select notification_revision=revision_before+1 from public.property_service_visits where id=visit_24),'notification revision advances on reschedule/reassignment');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=visit_24 and event_type='visit_assignment_removed' and recipient_user_id=worker_user),'old assignee removal event');
  perform pg_temp.assert_true(exists(select 1 from public.porter_notification_events where visit_id=visit_24 and event_type='visit_assignment' and recipient_user_id=second_user and notification_revision=revision_before+1),'new assignee assignment event');
  perform public.generate_due_porter_notifications(fixed_now);
  perform pg_temp.assert_true(not exists(select 1 from public.porter_notification_events where visit_id=visit_24 and event_type='visit_reminder_24h' and notification_revision=revision_before+1 and recipient_user_id=worker_user),'removed user receives no revised reminder');

  -- Terminal/started suppression.
  insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,plan_name,property_label,scheduled_date,scheduled_start_time,status,started_at)
    values(plan_id,client_id,property_id,crew_one,'Plan','Started','2030-01-01','11:00','In Progress',fixed_now) returning id into visit_started;
  insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,plan_name,property_label,scheduled_date,scheduled_start_time,status,completed_at)
    values(plan_id,client_id,property_id,crew_one,'Plan','Completed','2030-01-01','11:00','Completed',fixed_now) returning id into visit_completed;
  insert into public.property_service_visits(service_plan_id,client_id,property_id,assigned_crew_id,plan_name,property_label,scheduled_date,scheduled_start_time,status,cancelled_at)
    values(plan_id,client_id,property_id,crew_one,'Plan','Cancelled','2030-01-01','11:00','Cancelled',fixed_now) returning id into visit_cancelled;
  perform public.generate_due_porter_notifications(fixed_now);
  perform pg_temp.assert_true(not exists(select 1 from public.porter_notification_events where visit_id in(visit_started,visit_completed,visit_cancelled) and event_type in ('visit_reminder_24h','visit_reminder_1h','visit_missed_start')),'started/completed/cancelled visits suppressed');

  -- Planned route edits aggregate into one event per recipient/revision.
  select updated_at into version from public.property_service_routes where id=route_id;
  execute 'set local role authenticated';
  perform public.mutate_porter_route(route_id,version,'edit',jsonb_build_object('route_name','Updated Test Route','notes',null,'stops',jsonb_build_array(jsonb_build_object('visit_id',routed_visit))));
  execute 'reset role';
  perform pg_temp.assert_true((select count(*)=1 from public.porter_notification_events event where event.route_id=route_id and event.event_type='route_changed' and event.recipient_user_id=worker_user),'route change aggregates per recipient');

  -- Recipient-only RLS.
  perform set_config('request.jwt.claim.sub',worker_user::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_true(not exists(select 1 from public.porter_notification_events where recipient_user_id<>worker_user),'recipient RLS isolates events');
  execute 'reset role';
end $$;

rollback;
