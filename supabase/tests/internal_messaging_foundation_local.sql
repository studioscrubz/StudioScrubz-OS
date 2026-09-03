begin;

do $$
declare
  v_direct_id uuid;
  v_direct_message_id uuid;
  v_master_announcement_id uuid;
  v_admin_announcement_id uuid;
  v_required_announcement_id uuid;
  v_retry_direct_id uuid;
  v_passed boolean;
  v_failures integer := 0;
  v_tests integer := 0;
  v_error text;
  v_sqlstate text;
begin
  insert into auth.users(id,aud,role,email,created_at,updated_at) values
  ('fb100000-0000-0000-0000-000000000001','authenticated','authenticated','master@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000002','authenticated','authenticated','admin@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000003','authenticated','authenticated','manager@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000004','authenticated','authenticated','sales@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000005','authenticated','authenticated','lead@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000006','authenticated','authenticated','tech@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000007','authenticated','authenticated','unrelated@messages.invalid',now(),now()),
  ('fb100000-0000-0000-0000-000000000009','authenticated','authenticated','inactive-manager@messages.invalid',now(),now());
  insert into public.user_profiles(id,email,display_name,role,is_active) values
  ('fb100000-0000-0000-0000-000000000001','master@messages.invalid','Message Master','Master Admin',true),
  ('fb100000-0000-0000-0000-000000000002','admin@messages.invalid','Message Admin','Administrator',true),
  ('fb100000-0000-0000-0000-000000000003','manager@messages.invalid','Message Manager','Manager',true),
  ('fb100000-0000-0000-0000-000000000004','sales@messages.invalid','Message Sales','Sales',true),
  ('fb100000-0000-0000-0000-000000000005','lead@messages.invalid','Message Lead','Crew Lead',true),
  ('fb100000-0000-0000-0000-000000000006','tech@messages.invalid','Message Tech','Scrub Technician',true),
  ('fb100000-0000-0000-0000-000000000007','unrelated@messages.invalid','Message Unrelated','Scrub Technician',true),
  ('fb100000-0000-0000-0000-000000000009','inactive-manager@messages.invalid','Inactive Message Manager','Manager',false);

  set local role authenticated;
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000003',true);
  select id into v_direct_id from public.start_direct_conversation('fb100000-0000-0000-0000-000000000006');
  select id into v_direct_message_id from public.send_direct_message(v_direct_id,'Private hello');

  select exists(select 1 from public.conversations where id=v_direct_id) into v_passed;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% current member can read Direct conversation', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000006',true);
  select exists(select 1 from public.messages where id=v_direct_message_id) into v_passed;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% intended recipient can read Direct message', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000007',true);
  select not exists(select 1 from public.conversations where id=v_direct_id) into v_passed;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% unrelated user cannot read Direct conversation', case when v_passed then 'PASS' else 'FAIL' end;
  select not exists(select 1 from public.messages where id=v_direct_message_id) into v_passed;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% unrelated user cannot read Direct message', case when v_passed then 'PASS' else 'FAIL' end;

  v_passed := false;
  begin perform public.send_direct_message(v_direct_id,'Unauthorized hello'); exception when others then v_passed := sqlerrm = 'Direct conversation access denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% nonmember cannot send to guessed Direct conversation UUID', case when v_passed then 'PASS' else 'FAIL' end;
  v_passed := false;
  begin perform public.mark_messages_read(v_direct_id); exception when others then v_passed := sqlerrm = 'Conversation access denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% nonmember cannot mark messages read', case when v_passed then 'PASS' else 'FAIL' end;

  select count(*)=2 and count(*) filter (where user_id in ('fb100000-0000-0000-0000-000000000003','fb100000-0000-0000-0000-000000000006'))=2
    into v_passed from public.conversation_members where conversation_id=v_direct_id and left_at is null;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Direct conversation has exactly two intended active members', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000009',true);
  v_passed := false;
  begin perform public.start_direct_conversation('fb100000-0000-0000-0000-000000000006'); exception when others then v_passed := sqlerrm = 'An active authenticated profile is required.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% inactive user cannot start Direct conversation', case when v_passed then 'PASS' else 'FAIL' end;
  v_passed := false;
  begin perform public.send_direct_message(v_direct_id,'Inactive hello'); exception when others then v_passed := sqlerrm = 'An active authenticated profile is required.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% inactive user cannot send Direct message', case when v_passed then 'PASS' else 'FAIL' end;
  v_passed := false;
  begin perform public.send_company_announcement('Inactive manager','Must not send','Normal'); exception when others then v_passed := sqlerrm = 'Company Announcement permission denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% inactive management cannot send Company Announcement', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000003',true);
  v_passed := false;
  begin perform public.send_direct_message(v_direct_id,'   '); exception when check_violation then v_passed := true; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% blank Direct body rejected', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000006',true);
  v_passed := false;
  begin insert into public.messages(conversation_id,sender_user_id,body) values (v_direct_id,'fb100000-0000-0000-0000-000000000003','Impersonated'); exception when insufficient_privilege then v_passed := true; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% sender impersonation blocked', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000004',true);
  v_passed := false;
  begin perform public.send_company_announcement('Denied','Must not send','Normal'); exception when others then v_passed := sqlerrm = 'Company Announcement permission denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Sales cannot announce', case when v_passed then 'PASS' else 'FAIL' end;
  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000005',true);
  v_passed := false;
  begin perform public.send_company_announcement('Denied','Must not send','Normal'); exception when others then v_passed := sqlerrm = 'Company Announcement permission denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Crew Lead cannot announce', case when v_passed then 'PASS' else 'FAIL' end;
  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000006',true);
  v_passed := false;
  begin perform public.send_company_announcement('Denied','Must not send','Normal'); exception when others then v_passed := sqlerrm = 'Company Announcement permission denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Scrub Technician cannot announce', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000001',true);
  v_passed := false;
  begin select id into v_master_announcement_id from public.send_company_announcement('Master notice','Authorized','Normal'); v_passed := v_master_announcement_id is not null; exception when others then null; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Master Admin can announce', case when v_passed then 'PASS' else 'FAIL' end;
  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000002',true);
  v_passed := false;
  begin select id into v_admin_announcement_id from public.send_company_announcement('Admin notice','Authorized','Important'); v_passed := v_admin_announcement_id is not null; exception when others then null; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Administrator can announce', case when v_passed then 'PASS' else 'FAIL' end;
  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000003',true);
  v_passed := false;
  begin select id into v_required_announcement_id from public.send_company_announcement('Manager notice','Please acknowledge','Requires Acknowledgment'); v_passed := v_required_announcement_id is not null; exception when others then null; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Manager can announce', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000003',true);
  v_passed := false;
  begin perform public.send_company_announcement('Blank announcement','   ','Normal'); exception when check_violation then v_passed := true; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% blank Announcement body rejected', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000006',true);
  v_passed := false;
  begin perform public.acknowledge_required_announcement(v_master_announcement_id); exception when others then v_passed := sqlerrm = 'Required Announcement acknowledgment access denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Normal Announcement cannot use required-ack RPC', case when v_passed then 'PASS' else 'FAIL' end;
  v_passed := false;
  begin perform public.acknowledge_required_announcement(v_admin_announcement_id); exception when others then v_passed := sqlerrm = 'Required Announcement acknowledgment access denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% Important Announcement cannot use required-ack RPC', case when v_passed then 'PASS' else 'FAIL' end;
  v_passed := false;
  begin perform public.acknowledge_required_announcement(v_required_announcement_id); select exists(select 1 from public.announcement_acknowledgments where message_id=v_required_announcement_id and user_id='fb100000-0000-0000-0000-000000000006') into v_passed; exception when others then null; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% intended recipient can acknowledge Requires Acknowledgment announcement', case when v_passed then 'PASS' else 'FAIL' end;

  reset role;
  insert into auth.users(id,aud,role,email,created_at,updated_at) values ('fb100000-0000-0000-0000-000000000008','authenticated','authenticated','late@messages.invalid',now(),now());
  insert into public.user_profiles(id,email,display_name,role,is_active) values ('fb100000-0000-0000-0000-000000000008','late@messages.invalid','Late Message User','Scrub Technician',true);
  set local role authenticated;
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000008',true);
  v_passed := false;
  begin perform public.acknowledge_required_announcement(v_required_announcement_id); exception when others then v_passed := sqlerrm = 'Required Announcement acknowledgment access denied.'; end;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% late/non-recipient cannot acknowledge announcement', case when v_passed then 'PASS' else 'FAIL' end;

  perform set_config('request.jwt.claim.sub','fb100000-0000-0000-0000-000000000003',true);
  select id into v_retry_direct_id from public.start_direct_conversation('fb100000-0000-0000-0000-000000000006');
  v_passed := v_retry_direct_id = v_direct_id;
  v_tests := v_tests + 1; if not v_passed then v_failures := v_failures + 1; end if;
  raise notice '% duplicate Direct conversation reuses existing thread', case when v_passed then 'PASS' else 'FAIL' end;

  reset role;
  raise notice 'Messaging regression complete: % tests, % failures', v_tests, v_failures;
end;
$$;

rollback;
