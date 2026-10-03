-- Operational projection and atomic publication reuse the established source,
-- calendar, selection and audit authorities. No dates or geography are seeded.
create function public.payroll_holiday_operation_read(p_outlet_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); result jsonb;
begin
 if p_outlet_id is not null and not exists(select 1 from public.outlets where id=p_outlet_id) then raise exception 'Workplace not found.'; end if;
 select jsonb_build_object('outlets',coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'state_code',v.state_code,'state_revision_id',v.id) order by o.name),'[]'),
  'geographies',coalesce(jsonb_agg(distinct v.state_code) filter(where v.state_code is not null),'[]'),
  'unverified_count',count(*) filter(where v.state_code is null)) into result
 from public.outlets o left join lateral (select id,state_code from public.payroll_outlet_state_versions where outlet_id=o.id
  and effective_from<=timezone('Asia/Kuala_Lumpur',now())::date order by effective_from desc,created_at desc limit 1) v on true
 where p_outlet_id is null or o.id=p_outlet_id;
 return result;
end $$;

create function public.payroll_holiday_operation_publish(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype;
 yr integer:=(p_input->>'year')::integer; outlet uuid:=nullif(p_input->>'outlet_id','')::uuid;
 geography text:=p_input->>'geography'; request uuid:=(p_input->>'request_id')::uuid;
 context jsonb; row_data jsonb; h jsonb; decision jsonb; merged jsonb; manifest jsonb:='[]'; entries jsonb;
 selected uuid[]:='{}'; keys text[]:=array(select jsonb_array_elements_text(p_input->'selected_keys'));
 calendar uuid; policy uuid; previous uuid; previous_policy uuid:=nullif(p_input->>'previous_policy_id','')::uuid;
 candidate uuid:=nullif(p_input->>'candidate_id','')::uuid; entities uuid[]; kind text; fingerprint text; retry record;
 mandatory integer:=0; optional integer:=0;
begin
 if yr is null or geography is null or yr not between 2000 and 2200 or request is null or geography !~ '^MY-(0[1-9]|1[0-6])$'
  or jsonb_typeof(p_input->'selected_keys') is distinct from 'array' or jsonb_typeof(p_input->'decisions') is distinct from 'object'
  or coalesce((p_input->>'reviewed')::boolean,false) is not true then raise exception 'Review the applicable official calendar and company selection before publishing.'; end if;
 fingerprint:=encode(extensions.digest(p_input::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('payroll_holiday_year:'||yr,0));
 select e.details into retry from public.payroll_holiday_policy_events e where e.event_type='operation_calendar_published' and e.details->>'request_id'=request::text;
 if found then
  if retry.details->>'fingerprint'<>fingerprint then raise exception 'Publication request has changed.'; end if;
  return retry.details->'result';
 end if;
 context:=public.payroll_holiday_operation_read(outlet);
 if (context->>'unverified_count')::integer>0 or jsonb_array_length(context->'geographies')<>1 or context->'geographies'->>0 is distinct from geography then
  raise exception 'Confirm statutory workplace geography before publishing. Select one verified operation when workplaces span states.'; end if;
 select id into previous from public.payroll_holiday_calendar_versions where year=yr order by revision desc limit 1;
 if previous is distinct from nullif(p_input->>'previous_calendar_id','')::uuid then raise exception using errcode='40001',message='Annual calendar changed. Refresh before publishing.'; end if;
 if candidate is not null then
  select * into c from public.payroll_holiday_import_candidates where id=candidate for update;
  if c.id is null or c.year<>yr or c.revision is distinct from (p_input->>'candidate_revision')::integer or c.status not in ('needs_review','approved')
   or c.proposal_metadata->>'document_role'='supplement' then raise exception 'Refresh the applicable annual proposal before publishing.'; end if;
  if c.baseline_id is distinct from previous then raise exception using errcode='40001',message='Proposal baseline changed. Review a refreshed official proposal.'; end if;
  if c.is_qa and exists(select 1 from public.payroll_holiday_calendar_versions v where v.year=yr and v.status='published' and v.source_reference not like 'QA ONLY%'
   and not exists(select 1 from public.payroll_holiday_policy_events e where e.calendar_version_id=v.id and e.event_type='calendar_retired')) then raise exception 'QA imports cannot replace an operational calendar.'; end if;
  merged:=c.decisions;
  -- Only applicable decisions may be submitted. Unrelated evidence is untouched.
  for decision in select jsonb_build_object('key',key,'value',value) from jsonb_each(p_input->'decisions') loop
   if not exists(select 1 from jsonb_array_elements(c.rows) r where r->>'key'=decision->>'key' and
    (coalesce(r->'row',r->'previous'->'holiday')->>'scope'='national' or coalesce(r->'row',r->'previous'->'holiday')->>'state_code'=geography)) then raise exception 'A review decision is outside the working geography.'; end if;
   merged:=merged||jsonb_build_object(decision->>'key',decision->'value');
  end loop;
  perform public.payroll_holiday_candidate_review(c.id,c.revision,merged,false);
  for row_data in select value from jsonb_array_elements(c.rows) loop
   h:=coalesce(row_data->'row',row_data->'previous'->'holiday');
   if h->>'scope'<>'national' and h->>'state_code' is distinct from geography then continue; end if;
   decision:=merged->(row_data->>'key');
   if row_data->>'state'='blocked' or (row_data->>'state' in ('new','changed') and decision->>'action' is distinct from 'accept')
    or (row_data->>'state'='missing' and decision->>'action' is distinct from 'retain') then raise exception 'Resolve applicable uncertain, conflicting or missing dates before publishing.'; end if;
   kind:=coalesce(decision->>'kind',row_data->'previous'->>'kind',h->>'kind');
   if row_data->>'state' in ('matched','missing') then
    manifest:=manifest||jsonb_build_array(jsonb_build_object('date',h->>'holiday_date','name',h->>'name','scope',h->>'scope','state_code',h->>'state_code','kind',kind,'source_reference',row_data->'previous'->>'source_reference','substitutes_holiday_id',row_data->'previous'->>'substitutes_holiday_id'));
   else
    manifest:=manifest||jsonb_build_array(h||jsonb_build_object('kind',kind));
   end if;
   if kind='required' then mandatory:=mandatory+1;
   elsif row_data->>'key'=any(keys) and kind='gazetted' then optional:=optional+1; end if;
  end loop;
  if exists(select 1 from unnest(keys) k where not exists(select 1 from jsonb_array_elements(c.rows) r where r->>'key'=k and
    (coalesce(r->'row',r->'previous'->'holiday')->>'scope'='national' or coalesce(r->'row',r->'previous'->'holiday')->>'state_code'=geography))) then raise exception 'Company selection is outside the working calendar.'; end if;
  if mandatory<>5 or optional<6 then raise exception 'Confirm 5 mandatory paid holidays and select at least 6 company holidays.'; end if;
  -- Retain previously published evidence outside this operation; do not review,
  -- classify, delete or replace another state's source rows.
  for entries in select value from jsonb_array_elements(coalesce((select v.entries from public.payroll_holiday_calendar_versions v where v.id=previous),'[]')) loop
   h:=entries->'holiday';
   if h->>'scope'='national' or h->>'state_code'=geography then continue; end if;
   manifest:=manifest||jsonb_build_array(jsonb_build_object('date',h->>'holiday_date','name',h->>'name','scope',h->>'scope','state_code',h->>'state_code','kind',entries->>'kind','source_reference',entries->>'source_reference','substitutes_holiday_id',entries->>'substitutes_holiday_id'));
  end loop;
  calendar:=public.payroll_holiday_import(yr,jsonb_build_object('source_reference',c.source_reference||' · applicable operation '||geography,'source_complete',true,'holidays',manifest),true,previous,request);
  -- Resolve selection through the newly published canonical entries, never UI money/date calculations.
  select array_agg(distinct (e->>'holiday_id')::uuid) into selected from public.payroll_holiday_calendar_versions v cross join lateral jsonb_array_elements(v.entries) e
   where v.id=calendar and (e->>'kind'='required' or exists(select 1 from jsonb_array_elements(c.rows) r where r->>'key'=any(keys)
    and (coalesce(r->'row',r->'previous'->'holiday')->>'date'=e->'holiday'->>'holiday_date' or coalesce(r->'row',r->'previous'->'holiday')->>'holiday_date'=e->'holiday'->>'holiday_date')
    and coalesce(r->'row',r->'previous'->'holiday')->>'name'=e->'holiday'->>'name' and coalesce(r->'row',r->'previous'->'holiday')->>'scope'=e->'holiday'->>'scope'
    and coalesce(r->'row',r->'previous'->'holiday')->>'state_code' is not distinct from e->'holiday'->>'state_code'));
 else
  calendar:=nullif(p_input->>'calendar_id','')::uuid;
  if not exists(select 1 from public.payroll_holiday_calendar_versions where id=calendar and year=yr and status='published') then raise exception 'A published official calendar is required.'; end if;
  select array_agg((e->>'holiday_id')::uuid),count(*) filter(where e->>'kind'='required' and (e->'holiday'->>'scope'='national' or e->'holiday'->>'state_code'=geography)),count(*) filter(where e->>'kind'='gazetted' and e->>'holiday_id'=any(keys))
   into selected,mandatory,optional from public.payroll_holiday_calendar_versions v cross join lateral jsonb_array_elements(v.entries) e where v.id=calendar
   and (e->>'kind'='required' or e->>'holiday_id'=any(keys));
  if mandatory<>5 or optional<6 or exists(select 1 from unnest(keys) k where not exists(select 1 from public.payroll_holiday_calendar_versions v cross join lateral jsonb_array_elements(v.entries) e
   where v.id=calendar and e->>'holiday_id'=k and (e->'holiday'->>'scope'='national' or e->'holiday'->>'state_code'=geography))) then raise exception 'Confirm mandatory holidays and select 6 applicable company holidays.'; end if;
 end if;
 select array_agg(id order by id) into entities from public.legal_entities where is_active;
 if outlet is null then policy:=public.payroll_paid_holiday_default_save(calendar,selected,previous_policy,request);
 else policy:=public.payroll_paid_holiday_policy_save('Company Paid Holidays',calendar,selected,entities,array[outlet],
  'Verified workplace calendar: '||geography,true,previous_policy,request); end if;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_holiday_policy_events(policy_version_id,event_type,actor_employee_id,details) values(policy,'operation_calendar_published',a,
  jsonb_build_object('request_id',request,'fingerprint',fingerprint,'geography',geography,'outlet_id',outlet,'context',context,'candidate_id',candidate,'source_sha256',c.source_sha256,
   'candidate_revision',c.revision,'reviewed_keys',keys,'result',jsonb_build_object('calendar_id',calendar,'policy_id',policy)));
 if candidate is not null then
  perform set_config('feedx.holiday_candidate_command','yes',true);
  insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(candidate,'operation_published',a,
   jsonb_build_object('geography',geography,'calendar_id',calendar,'policy_id',policy,'source_sha256',c.source_sha256,'candidate_revision',c.revision,'applicable_manifest',manifest));
 end if;
 return jsonb_build_object('calendar_id',calendar,'policy_id',policy);
end $$;
revoke all on function public.payroll_holiday_operation_read(uuid),public.payroll_holiday_operation_publish(jsonb) from public,anon;
grant execute on function public.payroll_holiday_operation_read(uuid),public.payroll_holiday_operation_publish(jsonb) to authenticated;

-- A corrected date must not discard the existing paid-classification review flag.
-- Carry only existing source evidence, never client-asserted mandatory status.
do $$ declare definition text; anchor text; replacement text; begin
 definition:=pg_get_functiondef('public.payroll_holiday_candidate_parse(uuid,jsonb)'::regprocedure);
 anchor:='  -- Retain clean, unchanged source decisions by evidence identity, never by row index.';
 replacement:=$patch$  select value into prior_row from jsonb_array_elements(c.rows) where value->'row'->>'name'=btrim(r->>'name')
   and value->'row'->>'scope'=r->>'scope' and nullif(value->'row'->>'state_code','') is not distinct from nullif(r->>'state_code','') limit 1;
  if prior_row is not null then
   last_row:=output->(jsonb_array_length(output)-1);
   last_row:=last_row||jsonb_build_object('classification_review',coalesce((prior_row->>'classification_review')::boolean,false),'review_reason',prior_row->>'review_reason');
   last_row:=jsonb_set(last_row,'{row}',(last_row->'row')||jsonb_build_object('suggested_kind',prior_row->'row'->>'suggested_kind'));
   output:=jsonb_set(output,array[(jsonb_array_length(output)-1)::text],last_row);
  end if;
$patch$||anchor;
 if strpos(definition,anchor)=0 then raise exception 'Canonical parse correction anchor changed'; end if;
 execute replace(definition,anchor,replacement);
end $$;
