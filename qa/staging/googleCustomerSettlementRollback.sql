-- Staging only. Synthetic outcomes on existing QA employees; always rolled back.
-- Never run against Production. No Google-derived evidence is used or retained.
begin;
set local request.jwt.claims='{"role":"service_role"}';
create temporary table customer_test_before as
select md5(string_agg(to_jsonb(r)::text,'' order by id)) as hash from public.crew_performance_results r;
create temporary table customer_reward_before as select md5((select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_cycles t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_entries t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_adjustments t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_participants t)) as hash;
do $$
declare outlet uuid; result jsonb;
begin
 select outlet_id into outlet from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-CO-01' and period_start='2026-10-01';
 if outlet is null or exists(select 1 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where r.outlet_id=outlet and period_start='2026-10-01' and e.employee_code not like 'QA-%') then
   raise exception 'This fixture requires an existing QA-only October result cohort';
 end if;
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01');
 if result->>'reason'<>'google_retention_unresolved' then raise exception 'Live retention guard is not closed'; end if;
 if has_function_privilege('anon','public.crew_performance_settle_customer_month(uuid,date,jsonb,jsonb)','execute')
  or has_function_privilege('authenticated','public.crew_performance_settle_customer_month(uuid,date,jsonb,jsonb)','execute') then
  raise exception 'Settlement authority exposed to clients';
 end if;
end $$;

-- Transaction-local test substitution only. It is never committed or exposed.
create or replace function google_business_private.customer_settlement_permitted() returns boolean
language sql stable set search_path=public,pg_temp as $$ select true $$;


savepoint zero_review_month;
do $$
declare outlet uuid; context jsonb; basis jsonb; result jsonb;
begin
 select r.outlet_id into outlet from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-CO-01' and period_start='2026-10-01';
 update public.crew_performance_results set attendance_score=25,service_score=24,knowledge_score=15,peer_score=4,
   current_score=68,customer_score=null,total_score=null,status='review_required',finalized_at=null,finalized_by=null
   where outlet_id=outlet and period_start='2026-10-01';
 context:=public.crew_performance_settle_customer_month(outlet,'2026-10-01');
 basis:=(context->'basis')||jsonb_build_object('fetchedAt',now());
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis,'{"score":0,"positiveTarget":0,"quality":0}');
 if result->>'status'<>'settled' or (result->'summary'->>'score')::numeric<>0 then raise exception 'Confirmed zero month did not settle'; end if;
 if not exists(select 1 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-CO-01' and r.period_start='2026-10-01' and r.customer_score=0 and r.total_score=68
     and r.current_score=68 and r.status='finalized') then raise exception 'Zero Customer did not reconcile full 100-point model'; end if;
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis,'{"score":20,"positiveTarget":15,"quality":5}');
 if (result->>'changed')::int<>0 or (result->'summary'->>'score')::numeric<>0 then raise exception 'Zero settlement overwritten on retry'; end if;
 if (select hash from customer_reward_before) is distinct from (select md5((select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_cycles t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_entries t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_adjustments t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_participants t))) then
   raise exception 'Customer settlement changed Reward evidence'; end if;
end $$;
rollback to savepoint zero_review_month;

do $$
declare outlet uuid; context jsonb; result jsonb; basis jsonb; fixture public.crew_performance_results%rowtype;
 frozen_hash text; dimensions_hash text; after_hash text; first_summary jsonb;
begin
 select r.outlet_id into outlet from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-CO-01' and period_start='2026-10-01';
 update public.crew_performance_results r set attendance_score=25,service_score=24,knowledge_score=15,peer_score=4,
   current_score=68,customer_score=null,total_score=null,status='review_required',finalized_at=null,finalized_by=null
   where outlet_id=outlet and period_start='2026-10-01';
 -- One incomplete Service dimension must remain Pending, not gain zero.
 update public.crew_performance_results r set service_score=null where employee_id=(select id from public.employees where employee_code='QA-CREW-IP-01') and period_start='2026-10-01';
 -- One changed People snapshot must remain unresolved.
 update public.crew_performance_results r set components=jsonb_set(components,'{employment,state}','"unresolved"')
   where employee_id=(select id from public.employees where employee_code='QA-CREW-IF-01') and period_start='2026-10-01';
 -- Freeze one pre-existing synthetic finalized result before the worker runs.
 select * into fixture from public.crew_performance_results where outlet_id=outlet and period_start='2026-10-01'
   and employee_id not in (select id from public.employees where employee_code in ('QA-CREW-CO-01','QA-CREW-IP-01','QA-CREW-IF-01')) order by employee_id limit 1;
 update public.crew_performance_results set customer_score=20,total_score=88,current_score=88,status='finalized',finalized_at=now() where id=fixture.id;
 select md5(to_jsonb(r)::text) into frozen_hash from public.crew_performance_results r where id=fixture.id;
 select md5(string_agg(jsonb_build_array(employee_id,attendance_score,service_score,knowledge_score,peer_score)::text,'' order by id))
   into dimensions_hash from public.crew_performance_results where outlet_id=outlet and period_start='2026-10-01';
 context:=public.crew_performance_settle_customer_month(outlet);
 if not (context->'periods' ? '2026-10-01') then raise exception 'Pending month not discovered'; end if;
 context:=public.crew_performance_settle_customer_month(outlet,'2026-10-01');
 if context->>'status'<>'ready' then raise exception 'Fixture prerequisites unavailable: %',context; end if;
 basis:=(context->'basis')||jsonb_build_object('fetchedAt',now());
 result:=public.crew_performance_settle_customer_month(outlet,date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date,basis,'{"score":9.5,"positiveTarget":4.5,"quality":5}');
 if result->>'reason'<>'month_not_closed' then raise exception 'Current month settled'; end if;
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis||'{"target_revision":-1}','{"score":9.5,"positiveTarget":4.5,"quality":5}');
 if result->>'reason'<>'evidence_changed_or_expired' then raise exception 'Target revision guard failed'; end if;
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis||jsonb_build_object('fetchedAt',now()-interval '5 minutes'),'{"score":9.5,"positiveTarget":4.5,"quality":5}');
 if result->>'reason'<>'evidence_changed_or_expired' then raise exception 'Expiry guard failed'; end if;
 begin
  perform public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis,'{"score":9.5,"positiveTarget":4.5,"quality":5,"reviewer":"forbidden"}');
  raise exception 'Review content accepted';
 exception when sqlstate '22023' then null; end;
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis,'{"score":9.5,"positiveTarget":4.5,"quality":5}');
 first_summary:=result->'summary';
 if result->>'status'<>'settled' then raise exception 'Controlled settlement failed: %',result; end if;
 if not exists(select 1 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-CO-01' and r.period_start='2026-10-01' and r.customer_score=9.5
    and r.total_score=77.5 and r.current_score=77.5 and r.status='finalized' and r.finalized_by is null) then
   raise exception 'Automatic total or system settlement actor incorrect'; end if;
 if exists(select 1 from public.crew_performance_results where outlet_id=outlet and period_start='2026-10-01'
   and id<>fixture.id and customer_score is not null and customer_score<>9.5) then raise exception 'Outlet-shared result differs'; end if;
 if not exists(select 1 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-IP-01' and r.period_start='2026-10-01' and customer_score=9.5 and total_score is null and status<>'finalized') then
   raise exception 'Missing Service evidence finalized or Customer not settled'; end if;
 if exists(select 1 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-IF-01' and r.period_start='2026-10-01' and customer_score is not null) then
   raise exception 'Unresolved People history received Customer score'; end if;
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis,'{"score":20,"positiveTarget":15,"quality":5}');
 if (result->>'changed')::int<>0 or result->'summary' is distinct from first_summary then raise exception 'Retry rewrote settled evidence'; end if;
 select md5(string_agg(jsonb_build_array(employee_id,attendance_score,service_score,knowledge_score,peer_score)::text,'' order by id))
   into after_hash from public.crew_performance_results where outlet_id=outlet and period_start='2026-10-01';
 if after_hash<>dimensions_hash then raise exception 'Other dimensions changed'; end if;
 perform public.crew_refresh_performance(fixture.employee_id,'2026-10-01');
 select md5(to_jsonb(r)::text) into after_hash from public.crew_performance_results r where id=fixture.id;
 if after_hash<>frozen_hash then raise exception 'Finalized history changed'; end if;
 -- An eligible QA employee without an opened baseline must join automatically.
 update public.crew_performance_results set period_start='2026-08-01' where employee_id=(select id from public.employees where employee_code='QA-CREW-IF-01')
   and period_start='2026-10-01' and status<>'finalized';
 result:=public.crew_performance_settle_customer_month(outlet,'2026-10-01',basis,'{"score":20,"positiveTarget":15,"quality":5}');
 if not exists(select 1 from public.crew_performance_results r join public.employees e on e.id=r.employee_id
   where e.employee_code='QA-CREW-IF-01' and r.period_start='2026-10-01' and r.customer_score=9.5) then
   raise exception 'Missing eligible baseline was not initialized with frozen shared Customer'; end if;
 if (select hash from customer_reward_before) is distinct from (select md5((select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_cycles t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_entries t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_adjustments t) || (select coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'') from public.crew_reward_participants t))) then
   raise exception 'Customer settlement changed Reward evidence'; end if;
end $$;
rollback;

select 'rolled back' as outcome,google_business_private.customer_settlement_permitted() as live_retention_gate,
 md5(string_agg(to_jsonb(r)::text,'' order by id)) as performance_hash from public.crew_performance_results r;
