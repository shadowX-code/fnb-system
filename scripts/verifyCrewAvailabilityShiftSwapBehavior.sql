-- Real Staging rollback-only behavior and security verification.
begin;
create temporary table availability_swap_test_results(name text primary key, passed boolean, evidence text) on commit drop;
do $$
declare
  admin_id constant uuid:='266912cf-0e84-4074-82b5-0fc483080741'; outlet constant uuid:='e804c48d-6343-4bf8-99d7-9893c473948f';
  employee_a uuid; employee_b uuid; employee_c uuid; employee_d uuid; entry_id uuid; request_id uuid; publication_id uuid; payload jsonb; before_revision int; after_revision int;
begin
  select id into employee_a from public.employees where employee_code='QA-CREW-CO-01';
  select id into employee_b from public.employees where employee_code='QA-CREW-IP-01';
  select id into employee_c from public.employees where employee_code='QA-CREW-NS-01';
  select id into employee_d from public.employees where employee_code='QA-CREW-NA-01';

  payload:=public.crew_availability_mobile('availability-demo-QA-CREW-IP-01');
  insert into availability_swap_test_results values('weekly_and_multi_window_own_read',jsonb_array_length(payload->'weekly')=7 and jsonb_array_length(payload->'exceptions')>=1,'B received only B weekly pattern and temporary exception');

  begin execute 'set local role anon'; perform * from public.crew_availability_windows limit 1; execute 'reset role'; insert into availability_swap_test_results values('direct_availability_read_denied',false,'anon table SELECT unexpectedly succeeded');
  exception when insufficient_privilege then execute 'reset role'; insert into availability_swap_test_results values('direct_availability_read_denied',true,'anon table SELECT raised insufficient_privilege'); end;

  select e.id into entry_id from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.employee_id=employee_c and e.roster_date='2026-08-20' and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
  begin execute 'set local role anon'; perform public.crew_shift_request_submit('availability-demo-QA-CREW-CO-01',jsonb_build_object('entry_id',entry_id,'reason_code','other','reason','Cross employee attempt','coverage_mode','open')); execute 'reset role'; insert into availability_swap_test_results values('cross_employee_submit_denied',false,'A submitted C shift');
  exception when others then execute 'reset role'; insert into availability_swap_test_results values('cross_employee_submit_denied',sqlstate='42501','A cannot submit C published shift'); end;

  select p.id into publication_id from public.duty_roster_publications p where p.outlet_id=outlet and p.week_start_date='2026-08-17' order by p.revision desc limit 1;
  insert into public.duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,entry_type,template_code,template_name,position_snapshot,outlet_name_snapshot,shift_snapshot,published_at)
  values(publication_id,outlet,employee_a,'2026-08-23','off','OFF','Off','Service Crew','Friends Corner','{}'::jsonb,now()) returning id into entry_id;
  begin execute 'set local role anon'; perform public.crew_shift_request_submit('availability-demo-QA-CREW-CO-01',jsonb_build_object('entry_id',entry_id,'reason_code','other','reason','Non-working attempt','coverage_mode','open')); execute 'reset role'; insert into availability_swap_test_results values('non_working_shift_rejected',false,'OFF entry submitted');
  exception when others then execute 'reset role'; insert into availability_swap_test_results values('non_working_shift_rejected',sqlstate='42501','OFF entry rejected by authority'); end;

  select e.id into entry_id from public.duty_roster_published_entries e join public.duty_roster_publications p on p.id=e.publication_id where e.employee_id=employee_a and e.roster_date='2026-08-21' and p.revision=(select max(px.revision) from public.duty_roster_publications px where px.outlet_id=p.outlet_id and px.week_start_date=p.week_start_date);
  payload:=public.crew_shift_candidates('availability-demo-QA-CREW-CO-01',entry_id);
  insert into availability_swap_test_results values('leave_hard_block',coalesce(((select c->'eligibility'->>'leave_conflict' from jsonb_array_elements(payload->'candidates') c where c->>'id'=employee_d::text))::boolean,false),'D candidate shows approved leave conflict');
  insert into availability_swap_test_results values('availability_conflict_visible',coalesce(((select c->'eligibility'->'availability'->>'compatible' from jsonb_array_elements(payload->'candidates') c where c->>'id'=employee_c::text))::boolean,true)=false,'C candidate shows Friday unavailable');

  select id into request_id from public.crew_shift_requests where reason='[QA Shift Swap] Open Cover';
  execute 'set local role anon'; payload:=public.crew_shift_request_respond('availability-demo-QA-CREW-IP-01',request_id,'accept'); execute 'reset role';
  insert into availability_swap_test_results values('open_cover_accept_pending_manager',payload->>'status'='pending_manager','B offer moves request to manager review, not roster');

  select max(revision) into before_revision from public.duty_roster_publications where outlet_id=outlet and week_start_date='2026-08-17';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true); execute 'set local role authenticated'; payload:=public.crew_shift_request_review(request_id,'approve','Rollback-only behavior approval'); execute 'reset role';
  select max(revision) into after_revision from public.duty_roster_publications where outlet_id=outlet and week_start_date='2026-08-17';
  insert into availability_swap_test_results values('approval_creates_revision',after_revision=before_revision+1,'revision incremented from '||before_revision||' to '||after_revision);
  insert into availability_swap_test_results values('old_revision_immutable',exists(select 1 from public.duty_roster_published_entries e where e.publication_id<>(payload->>'publication_id')::uuid and e.employee_id=employee_a and e.roster_date='2026-08-18'),'old publication still retains requester');
  insert into availability_swap_test_results values('latest_roster_reassigned',(public.crew_roster_employee_day(employee_b,'2026-08-18')->>'employee_id') is null and (public.crew_roster_employee_day(employee_b,'2026-08-18')->>'entry_type')='working' and public.crew_roster_employee_day(employee_a,'2026-08-18')='null'::jsonb,'shared roster authority returns replacement only');

  begin execute 'set local role anon'; update public.duty_roster_published_entries set employee_id=employee_a where id=(select id from public.duty_roster_published_entries limit 1); execute 'reset role'; insert into availability_swap_test_results values('direct_published_roster_mutation_denied',false,'anon UPDATE unexpectedly succeeded');
  exception when insufficient_privilege then execute 'reset role'; insert into availability_swap_test_results values('direct_published_roster_mutation_denied',true,'anon UPDATE raised insufficient_privilege'); end;

  begin execute 'set local role anon'; perform public.crew_shift_requests_admin(outlet,null,null); execute 'reset role'; insert into availability_swap_test_results values('anon_admin_rpc_denied',false,'anon accessed Admin queue');
  exception when others then execute 'reset role'; insert into availability_swap_test_results values('anon_admin_rpc_denied',sqlstate='42501','Admin RPC rejected anonymous Crew context'); end;

  select id into request_id from public.crew_shift_requests where reason='[QA Shift Swap] Specific Pending Manager';
  execute 'set local role anon'; payload:=public.crew_shift_request_cancel('availability-demo-QA-CREW-CO-01',request_id); execute 'reset role';
  insert into availability_swap_test_results values('requester_cancel_pending',payload->>'status'='cancelled','Requester cancelled manager-pending request');
end $$;
select jsonb_build_object('suite','availability_shift_swap_staging_behavior','passed',count(*) filter(where passed),'failed',count(*) filter(where not passed),'total',count(*),'tests',jsonb_agg(jsonb_build_object('name',name,'passed',passed,'evidence',evidence) order by name)) result from availability_swap_test_results;
rollback;
