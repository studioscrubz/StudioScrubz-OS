alter table public.employee_performance_reviews
  drop constraint employee_performance_reviews_calculation_version_check,
  add constraint employee_performance_reviews_calculation_version_check check (calculation_version in ('v1','v2'));

create function public.calculate_employee_performance_review(p_employee_id uuid,p_period_days integer,p_period_end date,p_confirm_no_callbacks boolean)
returns public.employee_performance_reviews language plpgsql security definer set search_path='' as $$
declare
 start_date date; business_zone text; window_start timestamptz; window_end timestamptz; actor uuid:=auth.uid(); review public.employee_performance_reviews; revision_number integer;
 participation_count int; inspection_count int; inspection_total int; callback_count int; scope_count int; scope_total int; feedback_count int; labor_count int; attendance_count int; attendance_total int; compliance_count int; compliance_total int; teamwork_count int;
 inspection_points numeric; callback_points numeric; scope_points numeric; feedback_points numeric; labor_points numeric; attendance_points numeric; compliance_points numeric; teamwork_points numeric;
 quality_max numeric; quality_points numeric; measured numeric:=0; measured_max numeric:=0; overall numeric; serious boolean:=false; all_measured boolean;
 inspection_ids jsonb; callback_ids jsonb; scope_ids jsonb; feedback_ids jsonb; labor_ids jsonb; attendance_ids jsonb; compliance_ids jsonb; teamwork_ids jsonb;
 components jsonb; quality_component jsonb; evidence jsonb; inspection_state text; callback_state text; scope_state text; feedback_state text; quality_state text; labor_state text; attendance_state text; compliance_state text; teamwork_state text; final_class text;
begin
 if actor is null or not public.has_any_role(array['Master Admin','Administrator','Manager']) then raise exception 'Performance review management denied.' using errcode='42501'; end if;
 if p_period_days is null or p_period_days not in (30,90) or p_period_end is null then raise exception 'Review period must be 30 or 90 days.'; end if;
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.archived_at is null) then raise exception 'Employee is not available.'; end if;
 select b.timezone into business_zone from public.business_settings b
 join pg_catalog.pg_timezone_names z on z.name=b.timezone order by b.id limit 1;
 business_zone:=coalesce(business_zone,'UTC');
 if p_period_end>(now() at time zone business_zone)::date then raise exception 'Review end date cannot be in the future.'; end if;
 start_date:=p_period_end-(p_period_days-1);
 window_start:=start_date::timestamp at time zone business_zone;
 window_end:=(p_period_end+1)::timestamp at time zone business_zone;
 -- Serialize calculations for the same employee and review window.
 perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_period_days::text || ':' || p_period_end::text,0));

 select count(distinct t.job_id) into participation_count from public.time_entries t join public.jobs j on j.id=t.job_id where t.employee_id=p_employee_id and t.entry_type='Job' and t.status in ('Completed','Approved') and t.archived_at is null and t.labor_classification='Production' and t.total_hours>0 and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end;
 if participation_count=0 then
  components:=jsonb_build_object('quality',public.performance_component(null,35,0,'Insufficient Evidence','No meaningful Production participation in this period.'),'laborEfficiency',public.performance_component(null,25,0,'Insufficient Evidence','No meaningful Production participation in this period.'),'attendance',public.performance_component(null,15,0,'Insufficient Evidence','No authoritative attendance evidence.'),'compliance',public.performance_component(null,15,0,'Insufficient Evidence','No compliance evidence.'),'teamwork',public.performance_component(null,10,0,'Insufficient Evidence','No teamwork evidence.'));
  select coalesce(max(r.revision),0)+1 into revision_number from public.employee_performance_reviews r where r.employee_id=p_employee_id and r.review_period_days=p_period_days and r.period_start=start_date and r.period_end=p_period_end;
  insert into public.employee_performance_reviews(employee_id,review_period_days,period_start,period_end,calculation_version,revision,component_scores,evidence_snapshot,measured_points,measured_max_points,overall_score,classification,calculated_by) values(p_employee_id,p_period_days,start_date,p_period_end,'v2',revision_number,components,jsonb_build_object('participatingJobCount',0),0,0,null,'No Meaningful Participation',actor) returning * into review; return review;
 end if;

 select count(*),avg(case i.result when 'Pass' then 1 when 'Needs Attention' then case i.severity when 'Minor' then .75 when 'Moderate' then .5 else .25 end when 'Fail' then case i.severity when 'Minor' then .5 when 'Moderate' then .25 else 0 end end)*15,
  coalesce(jsonb_agg(distinct q.quality_evidence_id),'[]'::jsonb),bool_or(i.severity='Major' and i.result in ('Needs Attention','Fail'))
 into inspection_count,inspection_points,inspection_ids,serious from public.job_quality_employee_attributions q join public.job_quality_inspections x on x.id=q.quality_evidence_id and q.quality_evidence_type='Inspection' and x.inspection_status='Finalized' join public.job_quality_inspection_items i on i.inspection_id=x.id join public.jobs j on j.id=q.job_id where q.active and q.attribution_target='Employee' and q.employee_id=p_employee_id and i.result<>'Not Applicable' and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end;
 serious:=coalesce(serious,false);
 select count(distinct q.quality_evidence_id) into inspection_total from public.job_quality_employee_attributions q join public.job_quality_inspections x on x.id=q.quality_evidence_id and q.quality_evidence_type='Inspection' and x.inspection_status='Finalized' join public.jobs j on j.id=q.job_id where q.active and q.attribution_target='Employee' and q.employee_id=p_employee_id and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end;
 inspection_state:=case when inspection_count>0 then 'Measured' when inspection_total>0 then 'Not Applicable' else 'Insufficient Evidence' end;

 select count(*),10-least(10,coalesce(sum(penalty),0)),coalesce(jsonb_agg(id),'[]'::jsonb),serious or coalesce(bool_or(severity='Major'),false)
 into callback_count,callback_points,callback_ids,serious from (select distinct c.id,c.severity,case c.severity when 'Minor' then 1 when 'Moderate' then 2 when 'Major' then 4 end penalty from public.job_quality_employee_attributions q join public.job_quality_callbacks c on c.id=q.quality_evidence_id and q.quality_evidence_type='Callback' join public.jobs j on j.id=q.job_id where q.active and q.attribution_target='Employee' and q.employee_id=p_employee_id and c.status<>'Invalid / Not Attributable' and c.attribution='Job Quality Attributable' and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end) callbacks;
 -- A clean callback record needs an explicit manager review. Empty records alone are unknown.
 callback_state:=case when callback_count>0 or p_confirm_no_callbacks is true then 'Measured' else 'Insufficient Evidence' end;

 select count(*),avg(case s.result when 'Complete' then 5 when 'Partially Complete' then 2.5 when 'Not Complete' then 0 end),coalesce(jsonb_agg(s.id),'[]'::jsonb),serious or coalesce(bool_or(s.result='Not Complete'),false)
 into scope_count,scope_points,scope_ids,serious from public.job_quality_employee_attributions q join public.job_scope_completion_records s on s.id=q.quality_evidence_id and q.quality_evidence_type='Scope Completion' join public.jobs j on j.id=q.job_id where q.active and q.attribution_target='Employee' and q.employee_id=p_employee_id and s.result<>'Not Applicable' and s.attribution='Job Execution' and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end;
 select count(*) into scope_total from public.job_quality_employee_attributions q join public.job_scope_completion_records s on s.id=q.quality_evidence_id and q.quality_evidence_type='Scope Completion' join public.jobs j on j.id=q.job_id where q.active and q.attribution_target='Employee' and q.employee_id=p_employee_id and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end;
 scope_state:=case when scope_count>0 then 'Measured' when scope_total>0 then 'Not Applicable' else 'Insufficient Evidence' end;

 select count(*),avg(job_rating)/5*5,coalesce(jsonb_agg(job_id),'[]'::jsonb) into feedback_count,feedback_points,feedback_ids from (select f.job_id,avg(f.rating) job_rating from public.job_quality_employee_attributions q join public.job_customer_feedback f on f.id=q.quality_evidence_id and q.quality_evidence_type='Customer Feedback' join public.jobs j on j.id=q.job_id where q.active and q.attribution_target='Employee' and q.employee_id=p_employee_id and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end group by f.job_id) rated;
 feedback_state:=case when feedback_count>0 then 'Measured' else 'Insufficient Evidence' end;
 quality_points:=coalesce(inspection_points,0)
                + case when callback_state='Measured' then callback_points else 0 end
                + coalesce(scope_points,0) + coalesce(feedback_points,0);
 quality_max:=(case when inspection_state='Measured' then 15 else 0 end)
             +(case when callback_state='Measured' then 10 else 0 end)
             +(case when scope_state='Measured' then 5 else 0 end)
             +(case when feedback_state='Measured' then 5 else 0 end);
 quality_state:=case
   when quality_max=35 then 'Measured'
   when quality_max>0 then 'Partial Evidence'
   else 'Insufficient Evidence'
 end;

 with employee_jobs as (select t.job_id,sum(t.total_hours) employee_hours from public.time_entries t join public.jobs j on j.id=t.job_id where t.employee_id=p_employee_id and t.entry_type='Job' and t.status in ('Completed','Approved') and t.archived_at is null and t.labor_classification='Production' and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end group by t.job_id), ratios as (select ej.job_id,ej.employee_hours,sum(t.total_hours) filter(where t.labor_classification='Production') job_hours,greatest(s.budgeted_labor_hours+coalesce((select sum(a.labor_hours_delta) from public.job_labor_budget_adjustments a where a.job_id=ej.job_id),0),0) budget from employee_jobs ej join public.time_entries t on t.job_id=ej.job_id and t.entry_type='Job' and t.status in ('Completed','Approved') and t.archived_at is null join public.job_labor_budget_snapshots s on s.job_id=ej.job_id group by ej.job_id,ej.employee_hours,s.budgeted_labor_hours), scored as (select *,case when budget<=0 then null when job_hours/budget<=.90 then 25 when job_hours/budget<=1 then 24 when job_hours/budget<=1.10 then 21 when job_hours/budget<=1.25 then 17 when job_hours/budget<=1.50 then 10 when job_hours/budget<=2 then 5 else 0 end score from ratios)
 select count(*) filter(where score is not null),sum(score*employee_hours)/nullif(sum(employee_hours) filter(where score is not null),0),coalesce(jsonb_agg(job_id) filter(where score is not null),'[]'::jsonb) into labor_count,labor_points,labor_ids from scored;
 labor_state:=case when labor_count>0 then 'Measured' else 'Insufficient Evidence' end;

 with attendance as (select p.id,p.excused,p.current_status,coalesce((select e.metadata->>'latenessClass' from public.job_crew_presence_events e where e.presence_id=p.id and e.event_type='Arrival Confirmed' order by e.occurred_at desc limit 1),case when p.current_status='Present' then 'On Time' end) lateness from public.job_crew_presence p join public.jobs j on j.id=p.job_id where p.employee_id=p_employee_id and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end), scored as (select id,case when excused or current_status in ('Excused','Needs Attendance Review') then null when current_status in ('Absent','Absent - No Arrival') then 0 when current_status='Left Early' then .75 when lateness='On Time' then 1 when lateness='Minor Late' then .9 when lateness='Late' then .75 when lateness='Significant Late' then .5 else null end ratio from attendance)
 select count(*) filter(where ratio is not null),avg(ratio) filter(where ratio is not null)*15,coalesce(jsonb_agg(id) filter(where ratio is not null),'[]'::jsonb) into attendance_count,attendance_points,attendance_ids from scored;
 select count(*) into attendance_total from public.job_crew_presence p join public.jobs j on j.id=p.job_id where p.employee_id=p_employee_id and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end;
 attendance_state:=case when attendance_count>0 then 'Measured' when attendance_total>0 and not exists(select 1 from public.job_crew_presence p join public.jobs j on j.id=p.job_id where p.employee_id=p_employee_id and not p.excused and p.current_status<>'Excused' and coalesce(j.completed_at,j.operational_ended_at)>=window_start and coalesce(j.completed_at,j.operational_ended_at)<window_end) then 'Not Applicable' else 'Insufficient Evidence' end;

 select count(*),avg(case result when 'Compliant' then 15 when 'Non-Compliant' then 0 end),coalesce(jsonb_agg(id),'[]'::jsonb) into compliance_count,compliance_points,compliance_ids from public.job_compliance_records where employee_id=p_employee_id and ownership='Employee' and result in ('Compliant','Non-Compliant') and status='Finalized' and recorded_at>=window_start and recorded_at<window_end;
 select count(*) into compliance_total from public.job_compliance_records where employee_id=p_employee_id and ownership='Employee' and status='Finalized' and recorded_at>=window_start and recorded_at<window_end;
 compliance_state:=case when compliance_count>0 then 'Measured' when compliance_total>0 then 'Not Applicable' else 'Insufficient Evidence' end;

 select count(*),greatest(0,least(10,5+least(5,count(*) filter(where direction='Positive'))-least(5,2*count(*) filter(where direction='Concern')))),coalesce(jsonb_agg(id),'[]'::jsonb) into teamwork_count,teamwork_points,teamwork_ids from public.employee_teamwork_events where employee_id=p_employee_id and occurred_at>=window_start and occurred_at<window_end;
 teamwork_state:=case when teamwork_count>0 then 'Measured' else 'Insufficient Evidence' end;

 quality_component:=public.performance_component(quality_points,case when quality_max>0 then quality_max else 35 end,inspection_count+callback_count+scope_count+feedback_count
  +case when callback_count=0 and p_confirm_no_callbacks is true then 1 else 0 end,case when quality_max>0 then 'Measured' else quality_state end,'Inspection 15 + Callbacks 10 + Scope 5 + Feedback 5.',jsonb_build_object('inspection',public.performance_component(inspection_points,15,inspection_count,inspection_state,'Finalized explicitly attributed inspection items.',inspection_ids),'callbacks',public.performance_component(callback_points,10,
    case when callback_count=0 and p_confirm_no_callbacks is true then 1 else callback_count end,
    callback_state,
    case when callback_count=0 and p_confirm_no_callbacks is true
      then 'Management reviewed this window and confirmed no attributable callbacks.'
      else 'Valid explicitly attributed callbacks. Minor deducts 1, Moderate 2, and Major 4.'
    end,callback_ids),'scopeCompletion',public.performance_component(scope_points,5,scope_count,scope_state,'Explicitly attributed Job Execution scope results.',scope_ids),'customerFeedback',public.performance_component(feedback_points,5,feedback_count,feedback_state,'Explicitly attributed ratings averaged once per Job.',feedback_ids))) || jsonb_build_object('evidenceState',quality_state);
 components:=jsonb_build_object(
  'quality',quality_component,
  'laborEfficiency',public.performance_component(labor_points,25,labor_count,labor_state,'Production labor only; Approved Exception time excluded. Weighted by employee Production hours.',labor_ids),
  'attendance',public.performance_component(attendance_points,15,attendance_count,attendance_state,'Authoritative presence and arrival evidence; excused records excluded.',attendance_ids),
  'compliance',public.performance_component(compliance_points,15,compliance_count,compliance_state,'Finalized employee-owned evidence; Excused/N/A/external/management/shared excluded.',compliance_ids),
  'teamwork',public.performance_component(teamwork_points,10,teamwork_count,teamwork_state,'Bounded documented events; disputed events remain marked in the snapshot.',teamwork_ids));
 if quality_max>0 then measured:=measured+quality_points;measured_max:=measured_max+quality_max;end if; if labor_state='Measured' then measured:=measured+labor_points;measured_max:=measured_max+25;end if; if attendance_state='Measured' then measured:=measured+attendance_points;measured_max:=measured_max+15;end if; if compliance_state='Measured' then measured:=measured+compliance_points;measured_max:=measured_max+15;end if; if teamwork_state='Measured' then measured:=measured+teamwork_points;measured_max:=measured_max+10;end if;
 all_measured:=quality_state='Measured' and labor_state='Measured' and attendance_state='Measured' and compliance_state='Measured' and teamwork_state='Measured'; overall:=case when all_measured then round(measured,2) else null end; final_class:=case when serious then 'Quality Review Required' when all_measured then 'Measured' else 'Evidence Limited' end;
 evidence:=jsonb_build_object('participatingJobCount',participation_count,'businessTimezone',business_zone,'inspectionIds',inspection_ids,'callbackIds',callback_ids,'noCallbacksConfirmedBy',case when callback_count=0 and p_confirm_no_callbacks is true then actor end,'scopeIds',scope_ids,'feedbackJobIds',feedback_ids,'laborJobIds',labor_ids,'attendancePresenceIds',attendance_ids,'complianceIds',compliance_ids,'teamworkIds',teamwork_ids,'disputedTeamworkCount',(select count(*) from public.employee_teamwork_events t where t.employee_id=p_employee_id and t.acknowledgement_state='Disputed' and t.occurred_at>=window_start and t.occurred_at<window_end));
 select coalesce(max(r.revision),0)+1 into revision_number from public.employee_performance_reviews r where r.employee_id=p_employee_id and r.review_period_days=p_period_days and r.period_start=start_date and r.period_end=p_period_end;
 insert into public.employee_performance_reviews(employee_id,review_period_days,period_start,period_end,calculation_version,revision,component_scores,evidence_snapshot,measured_points,measured_max_points,overall_score,quality_gate_triggered,classification,calculated_by) values(p_employee_id,p_period_days,start_date,p_period_end,'v2',revision_number,components,evidence,round(measured,2),measured_max,overall,serious,final_class,actor) returning * into review; return review;
end $$;

revoke all on function public.calculate_employee_performance_review(uuid,integer,date,boolean) from public,anon,authenticated;
grant execute on function public.calculate_employee_performance_review(uuid,integer,date,boolean) to authenticated;

create or replace function public.calculate_employee_performance_review(p_employee_id uuid,p_period_days integer,p_period_end date default current_date)
returns public.employee_performance_reviews language sql security invoker set search_path='' as $$
 select public.calculate_employee_performance_review(p_employee_id,p_period_days,p_period_end,false);
$$;

notify pgrst,'reload schema';
