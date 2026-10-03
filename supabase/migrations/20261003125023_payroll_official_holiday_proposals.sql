-- Exact source evidence and established publication authorities remain canonical.
alter table public.payroll_holiday_import_candidates add column proposal_metadata jsonb not null default '{}'::jsonb;

create or replace function public.payroll_holiday_candidate_parse(p_id uuid,p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype; r jsonb; old jsonb; baseline jsonb:='[]'; output jsonb:='[]'; seen text[]:='{}'; matched uuid[]:='{}'; key text; issue text; state text; n integer:=0; d date; f text; retained_decisions jsonb:='{}'; prior_row jsonb; last_row jsonb;
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if not found then raise exception 'Import candidate not found.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Provide 1–500 verified transcription rows.'; end if;
 f:=encode(extensions.digest(p_rows::text,'sha256'),'hex');
 if c.parse_fingerprint=f then return; end if;
 if c.status not in ('fetched','needs_review') then raise exception 'Only an unpublished review may receive corrected source rows.'; end if;
 select entries into baseline from public.payroll_holiday_calendar_versions v where v.year=c.year and v.status='published'
  and not exists(select 1 from public.payroll_holiday_policy_events e where e.calendar_version_id=v.id and e.event_type='calendar_retired') order by revision desc limit 1;
 baseline:=coalesce(baseline,'[]');
 for r in select value from jsonb_array_elements(p_rows) loop
  n:=n+1; issue:=null; old:=null; d:=null;
  begin d:=(r->>'date')::date; exception when others then issue:='Invalid date'; end;
  if d is null or extract(year from d)::integer<>c.year then issue:='Date must belong to the selected year'; end if;
  if nullif(btrim(r->>'name'),'') is null then issue:='Holiday name required'; end if;
  if coalesce(r->>'scope','') not in ('national','state') then issue:='Choose National or State jurisdiction'; end if;
  if r->>'scope'='state' and coalesce(r->>'state_code','') not in ('MY-01','MY-02','MY-03','MY-04','MY-05','MY-06','MY-07','MY-08','MY-09','MY-10','MY-11','MY-12','MY-13','MY-14','MY-15','MY-16') then issue:='Canonical State code required'; end if;
  if r->>'scope'='national' and nullif(r->>'state_code','') is not null then issue:='National entry cannot specify one State'; end if;
  if coalesce(r->>'kind','gazetted') not in ('gazetted','special','substitute') then issue:='Paid-holiday requirements cannot be inferred by this importer'; end if;
  if nullif(btrim(r->>'source_locator'),'') is null then issue:='Document page/row reference required'; end if;
  if coalesce(r->>'uncertainty','')<>'' then issue:=r->>'uncertainty'; end if;
  key:=concat_ws('|',d,lower(btrim(r->>'name')),r->>'scope',r->>'state_code');
  if key=any(seen) then issue:='Duplicate date/name/jurisdiction'; end if; seen:=array_append(seen,key);
  if nullif(r->>'previous_holiday_id','') is not null then
   select value into old from jsonb_array_elements(baseline) where value->>'holiday_id'=r->>'previous_holiday_id';
   if old is null then issue:='Correction must link a holiday from the current published calendar'; end if;
  else
   select value into old from jsonb_array_elements(baseline) where value->'holiday'->>'holiday_date'=d::text and lower(value->'holiday'->>'name')=lower(btrim(r->>'name')) and value->'holiday'->>'scope'=r->>'scope' and nullif(value->'holiday'->>'state_code','') is not distinct from nullif(r->>'state_code','');
  end if;
  if old is null and (select count(*) from jsonb_array_elements(baseline) b where lower(b->'holiday'->>'name')=lower(btrim(r->>'name')) and b->'holiday'->>'scope'=r->>'scope' and nullif(b->'holiday'->>'state_code','') is not distinct from nullif(r->>'state_code',''))=1 then
   select value into old from jsonb_array_elements(baseline) where lower(value->'holiday'->>'name')=lower(btrim(r->>'name')) and value->'holiday'->>'scope'=r->>'scope' and nullif(value->'holiday'->>'state_code','') is not distinct from nullif(r->>'state_code','');
  end if;
  state:=case when old is null then 'new' when old->'holiday'->>'holiday_date'=d::text and old->'holiday'->>'name'=btrim(r->>'name') and old->'holiday'->>'scope'=r->>'scope' and nullif(old->'holiday'->>'state_code','') is not distinct from nullif(r->>'state_code','') and nullif(old->>'substitutes_holiday_id','') is not distinct from nullif(r->>'substitutes_holiday_id','') and (old->>'kind'='required' or old->>'kind'=coalesce(r->>'kind','gazetted')) then 'matched' else 'changed' end;
  if old is not null then
   if (old->>'holiday_id')::uuid=any(matched) then issue:='Conflicting corrections for one holiday'; end if;
   matched:=array_append(matched,(old->>'holiday_id')::uuid);
   if old->>'kind'='required' and state='changed' then issue:='Required holiday correction needs separate authority review'; end if;
  end if;
  if r->>'kind'='substitute' and not exists(select 1 from public.payroll_public_holidays h where h.id::text=r->>'substitutes_holiday_id' and extract(year from h.holiday_date)::integer=c.year and h.holiday_date<>d) then issue:='Identify the supported same-year original holiday'; end if;
  output:=output||jsonb_build_array(jsonb_build_object('key',n::text,'state',case when issue is null then state else 'blocked' end,'issue',issue,'previous',old,
   'row',jsonb_build_object('date',d,'name',btrim(r->>'name'),'scope',r->>'scope','state_code',nullif(r->>'state_code',''),'kind',case when state='matched' and old->>'kind'='required' then 'required' else coalesce(r->>'kind','gazetted') end,'source_reference',c.source_reference||' · '||(r->>'source_locator'),'substitutes_holiday_id',r->>'substitutes_holiday_id')));
  -- Retain clean, unchanged source decisions by evidence identity, never by row index.
  last_row:=output->(jsonb_array_length(output)-1);
  select value into prior_row from jsonb_array_elements(c.rows) where value->'row'->>'date'=d::text
   and value->'row'->>'name'=btrim(r->>'name') and value->'row'->>'scope'=r->>'scope'
   and nullif(value->'row'->>'state_code','') is not distinct from nullif(r->>'state_code','')
   and value->'row'->>'kind'=last_row->'row'->>'kind' and value->>'state'<>'blocked';
  if prior_row is not null and issue is null and c.decisions->(prior_row->>'key')->>'action'='accept' then
   retained_decisions:=retained_decisions||jsonb_build_object(n::text,c.decisions->(prior_row->>'key'));
  end if;
 end loop;
 for old in select value from jsonb_array_elements(baseline) where not ((value->>'holiday_id')::uuid=any(matched)) loop
  n:=n+1; output:=output||jsonb_build_array(jsonb_build_object('key',n::text,'state','missing','previous',old,'issue','Not present in source; retain unless separately corrected'));
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set status='needs_review',rows=output,decisions=retained_decisions,proposal_metadata=c.proposal_metadata,baseline_id=(select id from public.payroll_holiday_calendar_versions v where v.year=c.year and v.status='published' and not exists(select 1 from public.payroll_holiday_policy_events e where e.calendar_version_id=v.id and e.event_type='calendar_retired') order by revision desc limit 1),parser_version='verified_manifest_v1',parse_fingerprint=f,revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'parsed',a,jsonb_build_object('parser','verified_manifest_v1','input_sha256',f,'previous_rows',c.rows,'previous_decisions',c.decisions,'previous_proposal',c.proposal_metadata)),(p_id,'needs_review',a,jsonb_build_object('rows',output));
end $$;

create or replace function public.payroll_holiday_candidate_review(p_id uuid,p_revision integer,p_decisions jsonb,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype; r jsonb; action text;
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if not found or c.status not in ('needs_review','approved') then raise exception 'Candidate is not open for review.'; end if;
 if c.decisions=p_decisions and c.status=(case when p_approve then 'approved' else 'needs_review' end) then return; end if;
 if c.revision<>p_revision then raise exception using errcode='40001',message='Candidate changed. Refresh review.'; end if;
 if jsonb_typeof(p_decisions) is distinct from 'object' or p_approve is null then raise exception 'Review decisions required.'; end if;
 for r in select value from jsonb_array_elements(c.rows) loop
  action:=p_decisions->(r->>'key')->>'action';
  if action is not null and action not in ('accept','retain') then raise exception 'Invalid review decision.'; end if;
  if p_decisions->(r->>'key') ? 'kind' and coalesce(p_decisions->(r->>'key')->>'kind','') not in ('required','gazetted','special','substitute') then raise exception 'Review a supported holiday classification.'; end if;
  if r->'previous'->>'kind'='required' and p_decisions->(r->>'key')->>'kind' is not null and p_decisions->(r->>'key')->>'kind'<>'required' then raise exception 'Mandatory paid holidays cannot be downgraded.'; end if;
  if r->>'classification_review'='true' and action='accept' and p_decisions->(r->>'key')->>'kind' is null then raise exception 'Explicitly review the paid-holiday classification.'; end if;
  if p_approve and (r->>'state'='blocked' or (r->>'state' in ('new','changed') and action is distinct from 'accept') or (r->>'state'='missing' and action is distinct from 'retain')) then raise exception 'Resolve every exception; missing records must be explicitly retained.'; end if;
  if r->>'state'='changed' and action='accept' and nullif(btrim(p_decisions->(r->>'key')->>'remark'),'') is null then raise exception 'Explain the source correction.'; end if;
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set decisions=p_decisions,status=case when p_approve then 'approved' else 'needs_review' end,revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,case when p_approve then 'approved' else 'review_saved' end,a,jsonb_build_object('decisions',p_decisions,'complete_source_review',p_approve));
end $$;

create or replace function public.payroll_holiday_candidate_publish(p_id uuid,p_revision integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype; r jsonb; h uuid; entries jsonb:='[]'; result uuid;
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if not found then raise exception 'Candidate not found.'; end if;
 if c.status='published' then return c.published_calendar_id; end if;
 if c.status<>'approved' or c.revision<>p_revision then raise exception 'Approve the current candidate before publication.'; end if;
 if c.proposal_metadata->>'document_role'='supplement' then raise exception 'Review additional gazetted entitlement separately; a supplement cannot replace the annual calendar.'; end if;
 -- QA imports may not replace any live operational source calendar.
 if c.is_qa and exists(select 1 from public.payroll_holiday_calendar_versions v where v.year=c.year and v.status='published'
  and not exists(select 1 from public.payroll_holiday_policy_events e where e.calendar_version_id=v.id and e.event_type='calendar_retired')
  and v.source_reference not like 'QA ONLY%') then raise exception 'QA imports cannot replace an operational annual calendar.'; end if;
 for r in select value from jsonb_array_elements(c.rows) loop
  if r->>'state' in ('matched','missing') then entries:=entries||jsonb_build_array(r->'previous');
  else
   select id into h from public.payroll_public_holidays where holiday_date=(r->'row'->>'date')::date and lower(name)=lower(r->'row'->>'name') and scope=r->'row'->>'scope' and state_code is not distinct from nullif(r->'row'->>'state_code','') and legal_entity_id is null;
   if h is null then h:=public.payroll_holiday_save((r->'row'->>'date')::date,r->'row'->>'name',r->'row'->>'scope',r->'row'->>'source_reference',null,r->'row'->>'state_code',null); end if;
   entries:=entries||jsonb_build_array(jsonb_build_object('holiday_id',h,'kind',coalesce(c.decisions->(r->>'key')->>'kind',r->'row'->>'kind'),'source_reference',r->'row'->>'source_reference','substitutes_holiday_id',r->'row'->>'substitutes_holiday_id'));
  end if;
 end loop;
 result:=public.payroll_holiday_calendar_save(c.year,entries,c.source_reference,true,true,c.baseline_id,c.id);
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set status='published',published_calendar_id=result,revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'published',a,jsonb_build_object('calendar_version_id',result,'source_sha256',c.source_sha256));
 return result;
end $$;


-- Only the trusted fetch/extractor may label source rows as machine-verified.
-- Admin transcription continues through the existing authenticated parse command.
create function public.payroll_holiday_candidate_propose(p_id uuid,p_check_id uuid,p_source_sha256 text,p_rows jsonb,p_metadata jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.payroll_holiday_import_candidates%rowtype; chk public.payroll_holiday_update_checks%rowtype;
 actor_auth uuid; prior_sub text:=current_setting('request.jwt.claim.sub',true); r jsonb; source_row jsonb; output jsonb:='[]'; decisions jsonb:='{}';
begin
 select * into chk from public.payroll_holiday_update_checks where id=p_check_id;
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if c.id is null or chk.id is null or chk.completed_at is not null or chk.year<>c.year or c.is_qa or c.source_sha256 is distinct from p_source_sha256 then raise exception 'Proposal does not match the authorized check and captured source.'; end if;
 if c.status<>'fetched' then return; end if;
 if jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>64000 or p_metadata->>'parser' is distinct from 'bkpp_proposal_v1' or coalesce(p_metadata->>'document_role','') not in ('annual','supplement') then raise exception 'Unsupported extraction evidence.'; end if;
 select auth_user_id into actor_auth from public.employees where id=chk.actor_employee_id;
 if actor_auth is null then raise exception 'Check actor is no longer linked to Admin identity.'; end if;
 perform set_config('request.jwt.claim.sub',actor_auth::text,true);
 perform public.payroll_holiday_candidate_parse(p_id,p_rows);
 select * into c from public.payroll_holiday_import_candidates where id=p_id;
 for r in select value from jsonb_array_elements(c.rows) loop
  source_row:=p_rows->((r->>'key')::integer-1);
  if r->>'state'<>'missing' then
   r:=r||jsonb_build_object('classification_review',(r->>'state' <> 'matched' and coalesce((source_row->>'classification_review')::boolean,false)),'review_reason',source_row->>'review_reason');
   r:=jsonb_set(r,'{row}',(r->'row')||jsonb_build_object('source_locator',source_row->>'source_locator','suggested_kind',source_row->>'suggested_kind','uncertainty',source_row->>'uncertainty'));
   if r->>'state'='new' and not coalesce((r->>'classification_review')::boolean,false) then decisions:=decisions||jsonb_build_object(r->>'key',jsonb_build_object('action','accept','origin','verified_source_extraction')); end if;
  end if;
  output:=output||jsonb_build_array(r);
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set rows=output,decisions=decisions,proposal_metadata=p_metadata,parser_version=p_metadata->>'parser' where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'calendar_proposed',chk.actor_employee_id,jsonb_build_object('source_sha256',p_source_sha256,'metadata',p_metadata,'check_id',chk.id,'rows',output,'decisions',decisions));
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
end $$;

create function public.payroll_holiday_candidate_proposal_failure(p_id uuid,p_check_id uuid,p_message text)
returns void language plpgsql security definer set search_path=public as $$
declare c public.payroll_holiday_import_candidates%rowtype; chk public.payroll_holiday_update_checks%rowtype;
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 select * into chk from public.payroll_holiday_update_checks where id=p_check_id;
 if c.id is null or chk.id is null or chk.year<>c.year or chk.completed_at is not null or c.status<>'fetched' or c.is_qa then raise exception 'Invalid extraction failure context.'; end if;
 if nullif(btrim(p_message),'') is null or length(p_message)>2000 then raise exception 'Extraction failure reason required.'; end if;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set proposal_metadata=jsonb_build_object('extraction_error',p_message,'check_id',chk.id) where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'extraction_review_required',chk.actor_employee_id,jsonb_build_object('reason',p_message,'check_id',chk.id));
end $$;
revoke all on function public.payroll_holiday_candidate_propose(uuid,uuid,text,jsonb,jsonb),public.payroll_holiday_candidate_proposal_failure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.payroll_holiday_candidate_propose(uuid,uuid,text,jsonb,jsonb),public.payroll_holiday_candidate_proposal_failure(uuid,uuid,text) to service_role;

create or replace function public.payroll_holiday_discovered_source_capture(p_year integer,p_url text,p_reference text,p_filename text,p_pdf_base64 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); h text; c public.payroll_holiday_import_candidates%rowtype; i uuid;
begin
 if p_url !~ '^https://www\.kabinet\.gov\.my/storage/[^?#]+\.pdf$' or length(p_pdf_base64)>7000000 then raise exception 'Discovered source is not allowed.'; end if;
 h:=encode(extensions.digest(decode(p_pdf_base64,'base64'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext('holiday-source:'||p_year||':'||h));
 select * into c from public.payroll_holiday_import_candidates where year=p_year and not is_qa and status<>'retired' and source_sha256=h order by created_at desc limit 1;
 if found and (c.status='fetched' or c.parser_version='bkpp_proposal_v1') then return jsonb_build_object('id',c.id,'created',false,'status',c.status); end if;
 i:=public.payroll_holiday_candidate_capture(p_year,p_url,p_reference,p_filename,p_pdf_base64,p_request_id,false);
 if c.id is not null then
  insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(i,'source_reinterpreted',a,jsonb_build_object('previous_candidate_id',c.id,'reason','New verified extraction parser; previous source review and publication remain immutable'));
 end if;
 return jsonb_build_object('id',i,'created',true,'status','fetched');
end $$;

