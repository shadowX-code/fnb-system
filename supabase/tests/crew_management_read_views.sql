-- Run only on Staging, inside BEGIN/ROLLBACK. Fixtures and QA sessions never persist.
do $$
declare m uuid; outlet uuid; other_outlet uuid; tok text:=encode(extensions.gen_random_bytes(32),'hex');
  crew_tok text:=encode(extensions.gen_random_bytes(32),'hex'); emp uuid; item uuid; i record; value jsonb;
  ids uuid[]; pub1 uuid:=gen_random_uuid(); pub2 uuid:=gen_random_uuid(); week date;
  day date:=timezone('Asia/Kuala_Lumpur',now())::date; revision integer; entries uuid[]:='{}'; entry uuid;
  denied boolean; checked integer:=0;
begin
  select e.id into m from employees e join crew_access ca on ca.employee_id=e.id
    where lower(e.workplace)='management' and ca.access_state='active' and cardinality(public.crew_authorized_outlet_ids(e.id))>0 limit 1;
  assert m is not null,'Management fixture account required';
  select x into outlet from unnest(public.crew_authorized_outlet_ids(m)) x where exists(select 1 from crew_operation_instances where outlet_id=x and is_operational) limit 1;
  select x into other_outlet from unnest(public.crew_authorized_outlet_ids(m)) x where x<>outlet limit 1;
  insert into crew_sessions(employee_id,token_hash,expires_at) values(m,encode(extensions.digest(tok,'sha256'),'hex'),now()+interval '5 minutes');
  perform public.crew_management_today_team(tok,outlet);
  denied:=false; begin perform public.crew_management_today_team(tok,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Out-of-scope team read must fail';
  for i in select * from crew_operation_instances where outlet_id=outlet and is_operational order by business_date desc limit 40 loop
    value:=public.crew_management_task_detail(tok,outlet,i.id);
    assert value->>'read_only'='true' and jsonb_typeof(value->'blocks')='array','Authorized Management detail';
    if i.completion_rule<>'one_for_team' then
      assert jsonb_array_length(value->'executions')=(select count(*) from crew_task_instance_assignees where instance_id=i.id),'Individual execution evidence must remain separate';
    end if;
    denied:=false; begin perform public.crew_management_task_detail(tok,other_outlet,i.id); exception when insufficient_privilege then denied:=true; end;
    assert denied,'Cross-outlet detail ID must fail';
    select id into item from crew_operation_instance_items where instance_id=i.id limit 1;
    if item is not null then
      denied:=false; begin perform public.crew_tasks_update_block(tok,item,'completed','{}',null,null); exception when insufficient_privilege then denied:=true; end;
      assert denied,'Read authority must not grant execution';
    end if;
    denied:=false; begin perform public.crew_tasks_reset(tok,i.id); exception when insufficient_privilege then denied:=true; end;
    assert denied,'Read authority must not grant reset';
    checked:=checked+1;
  end loop;
  assert checked>0,'Existing occurrences required';
  select e.id into emp from employees e join crew_access ca on ca.employee_id=e.id
    where ca.access_state='active' and ca.primary_outlet_id=outlet and lower(e.workplace)<>'management'
    and coalesce(e.is_active,true) and e.employment_status not in ('resigned','terminated') limit 1;
  assert emp is not null,'Crew fixture account required';
  insert into crew_sessions(employee_id,token_hash,expires_at) values(emp,encode(extensions.digest(crew_tok,'sha256'),'hex'),now()+interval '5 minutes');
  denied:=false; begin perform public.crew_management_today_team(crew_tok,outlet); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Ordinary Crew cannot read team data';
  denied:=false; begin perform public.crew_management_task_detail(crew_tok,outlet,(select id from crew_operation_instances where outlet_id=outlet and is_operational limit 1)); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Ordinary Crew cannot use Management detail';
  -- Original reviewed assigned-Crew function is installed as a temporary test-only alias.
  for i in select x.id from crew_operation_instances x join crew_task_instance_assignees a on a.instance_id=x.id and a.employee_id=emp where x.is_operational and x.outlet_id=outlet limit 50 loop
    assert public.crew_tasks_detail(crew_tok,i.id)=public.qa_original_crew_tasks_detail(crew_tok,i.id),'Assigned-Crew payload changed';
  end loop;
  assert not has_function_privilege('anon','public.crew_tasks_detail_projection(uuid,uuid)','EXECUTE'),'Internal projector must not be callable';
  assert not has_function_privilege('authenticated','public.crew_tasks_detail_projection(uuid,uuid)','EXECUTE'),'Internal projector must not be callable';

  select array_agg(id) into ids from (select e.id from employees e where public.crew_resolve_employee_outlet(e.id)=outlet
    and not exists(select 1 from crew_attendance_records where employee_id=e.id and status='open')
    and not exists(select 1 from crew_leave_roster_projections where employee_id=e.id and roster_date=day)
    order by e.id limit 6) candidates;
  assert cardinality(ids)=6,'Six safe roster fixtures required';
  week:=date_trunc('week',day)::date;
  select coalesce(max(p.revision),0)+1 into revision from duty_roster_publications p where p.outlet_id=outlet and p.week_start_date=week;
  insert into duty_roster_publications(id,outlet_id,week_start_date,week_end_date,revision) values(pub1,outlet,week,week+6,revision),(pub2,outlet,week,week+6,revision+1);
  -- Old publication has a now-removed working employee. Current revision has four working and one off.
  insert into duty_roster_published_entries(publication_id,outlet_id,employee_id,roster_date,start_time,end_time,entry_type,outlet_name_snapshot,published_at)
    values(pub1,outlet,ids[6],day,'08:00','17:00','working','QA',now());
  for n in 1..5 loop
    entry:=gen_random_uuid(); entries:=array_append(entries,entry);
    insert into duty_roster_published_entries(id,publication_id,outlet_id,employee_id,roster_date,start_time,end_time,entry_type,outlet_name_snapshot,published_at)
      values(entry,pub2,outlet,ids[n],day,case when n=4 then '23:59'::time else '00:00'::time end,'23:59',case when n=5 then 'off' else 'working' end,'QA',now());
  end loop;
  insert into crew_attendance_records(employee_id,outlet_id,clock_in_at,status,scheduled_roster_entry_id)
    values(ids[1],outlet,now()-interval '5 minutes','open',entries[1]);
  insert into crew_attendance_records(employee_id,outlet_id,clock_in_at,clock_out_at,status,scheduled_roster_entry_id)
    values(ids[2],outlet,now()-interval '1 hour',now(),'completed',entries[2]);
  value:=public.crew_management_today_team(tok,outlet);
  assert value->'summary'=jsonb_build_object('scheduled',4,'clocked_in',1,'not_clocked_in',2,'completed',1),'Today summary partition';
  assert (select count(distinct row->>'state') from jsonb_array_elements(value->'employees') row)=4,'Clocked In, Completed, Upcoming and Not Clocked In states';
  assert not exists(select 1 from jsonb_array_elements(value->'employees') row where (row->>'employee_id')::uuid in (ids[5],ids[6])),'Off and superseded shifts excluded';
end; $$;
select 'PASS: authorized/scoped read-only Task evidence; unchanged Crew detail; four team states; latest published roster; no execution/reset authority' as result;
