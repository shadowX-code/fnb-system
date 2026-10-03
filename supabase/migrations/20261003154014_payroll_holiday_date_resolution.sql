-- Explicit date resolution is appended to existing import evidence. Transcription
-- saves are never confirmations; captured sources and raw rows remain unchanged.
create unique index payroll_holiday_date_request_idx on public.payroll_holiday_import_events ((details->>'request_id')) where event_type='date_confirmed';

create function public.payroll_holiday_row_identity(r jsonb) returns text
language sql immutable set search_path=public as $$
 select encode(extensions.digest(jsonb_build_array(r->'row'->>'name',r->'row'->>'scope',r->'row'->>'state_code',r->'row'->>'source_locator',r->'row'->>'date')::text,'sha256'),'hex')
$$;
create function public.payroll_holiday_row_fingerprint(r jsonb) returns text
language sql immutable set search_path=public as $$ select encode(extensions.digest((r-'key')::text,'sha256'),'hex') $$;

create function public.payroll_holiday_effective_rows(p_id uuid,p_hash text,p_year integer,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r jsonb; e record; result jsonb:='[]'; output jsonb:='[]'; h jsonb; issue text; state text; d date; resolvable boolean;
begin
 for r in select value from jsonb_array_elements(p_rows) loop
  resolvable:=r->>'state'='blocked' and (r->>'issue' like 'Official source marks this date subject to change.%'
   or r->>'issue' like 'Conditional alternative:%' or r->>'issue'='Source date and weekday disagree. Verify against the document.');
  select id,occurred_at,actor_employee_id,details into e from public.payroll_holiday_import_events where candidate_id=p_id and event_type='date_confirmed'
   and details->>'source_sha256'=p_hash and details->>'row_identity'=public.payroll_holiday_row_identity(r)
   and details->>'row_fingerprint'=public.payroll_holiday_row_fingerprint(r) order by occurred_at desc,id desc limit 1;
  r:=r||jsonb_build_object('source_row_identity',public.payroll_holiday_row_identity(r),'source_row_fingerprint',public.payroll_holiday_row_fingerprint(r),'date_confirmable',coalesce(resolvable,false),'source_issue',r->>'issue');
  if found and resolvable then
   r:=r||jsonb_build_object('source_row',r-'source_row_identity'-'source_row_fingerprint'-'date_confirmable'-'source_issue',
    'date_resolution',e.details||jsonb_build_object('id',e.id,'confirmed_at',e.occurred_at,'actor_employee_id',e.actor_employee_id));
   h:=r->'row'||jsonb_build_object('date',e.details->>'confirmed_date','source_reference',e.details->>'official_reference');
   d:=(h->>'date')::date; issue:=null;
   -- Validate independent structural, jurisdiction, baseline and entitlement gates.
   if extract(year from d)::integer<>p_year then issue:='Date must belong to the selected year'; end if;
   if nullif(btrim(h->>'name'),'') is null then issue:='Holiday name required'; end if;
   if h->>'scope' not in ('national','state') or (h->>'scope'='national' and nullif(h->>'state_code','') is not null)
    or (h->>'scope'='state' and coalesce(h->>'state_code','') !~ '^MY-(0[1-9]|1[0-6])$') then issue:='Verify the applicable jurisdiction'; end if;
   if h->>'kind' not in ('gazetted','special','substitute','required') then issue:='Review holiday classification'; end if;
   state:=case when r->'previous'->'holiday' is null then 'new'
    when r->'previous'->'holiday'->>'holiday_date'=d::text then 'matched' else 'changed' end;
   if r->'previous'->>'kind'='required' and state='changed' then issue:='Required holiday correction needs separate authority review'; end if;
   if h->>'kind'='substitute' and not exists(select 1 from payroll_public_holidays where id::text=h->>'substitutes_holiday_id' and extract(year from holiday_date)::integer=p_year and holiday_date<>d) then issue:='Identify the supported same-year original holiday'; end if;
   if h->>'kind'='special' then issue:='Additional s8 paid entitlement requires explicit treatment outside the annual five-required plus six-optional selection.'; end if;
   r:=r||jsonb_build_object('row',h,'state',case when issue is null then state else 'blocked' end,'issue',issue);
  end if;
  result:=result||jsonb_build_array(r);
 end loop;
 -- A confirmed date cannot erase a separate duplicate/conflicting-date blocker.
 for r in select value from jsonb_array_elements(result) loop
  if r ? 'date_resolution' and exists(select 1 from jsonb_array_elements(result) other where other->>'key'<>r->>'key'
   and other->'row'->>'date'=r->'row'->>'date' and lower(other->'row'->>'name')=lower(r->'row'->>'name')
   and other->'row'->>'scope'=r->'row'->>'scope' and other->'row'->>'state_code' is not distinct from r->'row'->>'state_code') then
   r:=r||jsonb_build_object('state','blocked','issue','Duplicate date/name/jurisdiction');
  end if;
  output:=output||jsonb_build_array(r);
 end loop;
 return output;
end $$;

create function public.payroll_holiday_date_confirm(p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype; r jsonb; context jsonb; e record;
 candidate uuid:=(p_input->>'candidate_id')::uuid; request uuid:=(p_input->>'request_id')::uuid; outlet uuid:=nullif(p_input->>'outlet_id','')::uuid;
 d date:=(p_input->>'confirmed_date')::date; ref text:=btrim(p_input->>'official_reference'); f text:=encode(extensions.digest(p_input::text,'sha256'),'hex'); result uuid; geography text;
begin
 if request is null or d is null or nullif(ref,'') is null or length(ref)>2000 then raise exception 'Confirm the date and official reference.'; end if;
 select * into c from payroll_holiday_import_candidates where id=candidate for update;
 if c.id is null or c.status not in ('needs_review','approved') then raise exception 'Only an unpublished proposal can receive date confirmation.'; end if;
 select id,details into e from payroll_holiday_import_events where event_type='date_confirmed' and details->>'request_id'=request::text;
 if found then
  if e.details->>'request_fingerprint'<>f or e.details->>'candidate_id'<>candidate::text then raise exception 'Confirmation request has changed.'; end if;
  return jsonb_build_object('confirmation_id',e.id,'candidate_id',candidate);
 end if;
 if c.revision is distinct from (p_input->>'candidate_revision')::integer or c.source_sha256 is distinct from p_input->>'source_sha256' then raise exception using errcode='40001',message='Source evidence changed. Refresh before confirming.'; end if;
 select value into r from jsonb_array_elements(c.rows) where value->>'key'=p_input->>'row_key';
 if r is null or public.payroll_holiday_row_identity(r) is distinct from p_input->>'row_identity'
  or public.payroll_holiday_row_fingerprint(r) is distinct from p_input->>'row_fingerprint' then raise exception 'Proposed row evidence changed. Refresh before confirming.'; end if;
 if r->>'state' is distinct from 'blocked' or not coalesce((r->>'issue' like 'Official source marks this date subject to change.%'
  or r->>'issue' like 'Conditional alternative:%' or r->>'issue'='Source date and weekday disagree. Verify against the document.'),false) then raise exception 'This blocker requires its own source, jurisdiction or classification review.'; end if;
 if extract(year from d)::integer<>c.year then raise exception 'Confirmed date must belong to the selected year.'; end if;
 context:=public.payroll_holiday_operation_read(outlet); geography:=context->'geographies'->>0;
 if (context->>'unverified_count')::integer<>0 or jsonb_array_length(context->'geographies')<>1
  or (r->'row'->>'scope'<>'national' and r->'row'->>'state_code' is distinct from geography) then raise exception 'Verify statutory geography and confirm only an applicable date.'; end if;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 insert into payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(candidate,'date_confirmed',a,
  jsonb_build_object('candidate_id',candidate,'source_sha256',c.source_sha256,'row_identity',public.payroll_holiday_row_identity(r),
   'row_fingerprint',public.payroll_holiday_row_fingerprint(r),'source_row',r,'confirmed_date',d,'official_reference',ref,
   'request_id',request,'request_fingerprint',f,'outlet_id',outlet,'geography',geography,'geography_evidence',context)) returning id into result;
 -- Confirmation accepts the verified date only. Paid classification stays separate.
 update payroll_holiday_import_candidates set revision=revision+1,decisions=decisions||jsonb_build_object(r->>'key',coalesce(decisions->(r->>'key'),'{}')||jsonb_build_object('action','accept','remark',ref,'origin','explicit_date_confirmation')) where id=candidate;
 return jsonb_build_object('confirmation_id',result,'candidate_id',candidate);
end $$;

-- Every existing read/publication consumer uses the same effective-row projection.
do $$ declare definition text; anchor text; fn text; begin
 definition:=pg_get_functiondef('public.payroll_holiday_candidate_read(integer,boolean)'::regprocedure);
 anchor:='jsonb_build_object(''additional_confirmations''';
 if strpos(definition,anchor)=0 then raise exception 'Candidate read anchor changed'; end if;
 execute replace(definition,anchor,'jsonb_build_object(''rows'',public.payroll_holiday_effective_rows(c.id,c.source_sha256,c.year,c.rows),''additional_confirmations''');
 foreach fn in array array['public.payroll_holiday_candidate_review(uuid,integer,jsonb,boolean)','public.payroll_holiday_candidate_publish(uuid,integer)'] loop
  definition:=pg_get_functiondef(fn::regprocedure); anchor:='for r in select value from jsonb_array_elements(c.rows) loop';
  if strpos(definition,anchor)=0 then raise exception 'Candidate consumer anchor changed: %',fn; end if;
  execute replace(definition,anchor,'for r in select value from jsonb_array_elements(public.payroll_holiday_effective_rows(c.id,c.source_sha256,c.year,c.rows)) loop');
 end loop;
 definition:=pg_get_functiondef('public.payroll_holiday_operation_publish(jsonb)'::regprocedure);
 anchor:='merged:=c.decisions;';
 if strpos(definition,anchor)=0 then raise exception 'Operation publication anchor changed'; end if;
 execute replace(definition,anchor,'c.rows:=public.payroll_holiday_effective_rows(c.id,c.source_sha256,c.year,c.rows); '||anchor);
 definition:=pg_get_functiondef('public.payroll_additional_holiday_confirm(uuid,text,text,uuid)'::regprocedure);
 anchor:='jsonb_array_elements(c.rows)';
 if strpos(definition,anchor)=0 then raise exception 'Additional entitlement anchor changed'; end if;
 execute replace(definition,anchor,'jsonb_array_elements(public.payroll_holiday_effective_rows(c.id,c.source_sha256,c.year,c.rows))');
end $$;
revoke all on function public.payroll_holiday_row_identity(jsonb),public.payroll_holiday_row_fingerprint(jsonb),public.payroll_holiday_effective_rows(uuid,text,integer,jsonb),public.payroll_holiday_date_confirm(jsonb) from public,anon,authenticated;
grant execute on function public.payroll_holiday_date_confirm(jsonb) to authenticated;
