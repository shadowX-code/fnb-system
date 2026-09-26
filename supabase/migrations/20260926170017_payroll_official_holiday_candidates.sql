-- Controlled source evidence precedes, but never replaces, Annual Calendar publication.
-- Bounded PDFs are private database evidence: no public URLs or client-writable tables.
create table public.payroll_holiday_import_candidates (
 id uuid primary key default gen_random_uuid(), year integer not null check(year between 2000 and 2200),
 source_url text not null, source_reference text not null, source_pdf bytea not null,
 source_sha256 text not null, filename text not null, is_qa boolean not null default false,
 status text not null check(status in ('fetched','parsed','needs_review','approved','published','retired')),
 baseline_id uuid references public.payroll_holiday_calendar_versions(id),
 rows jsonb not null default '[]', decisions jsonb not null default '{}',
 parser_version text, parse_fingerprint text, revision integer not null default 1,
 request_id uuid not null unique, fingerprint text not null,
 published_calendar_id uuid references public.payroll_holiday_calendar_versions(id),
 actor_employee_id uuid not null references public.employees(id), created_at timestamptz not null default clock_timestamp()
);
create index payroll_holiday_candidates_year on public.payroll_holiday_import_candidates(year,created_at desc);
create table public.payroll_holiday_import_events (
 id uuid primary key default gen_random_uuid(), candidate_id uuid not null references public.payroll_holiday_import_candidates(id),
 event_type text not null, actor_employee_id uuid not null references public.employees(id),
 occurred_at timestamptz not null default clock_timestamp(), details jsonb not null
);
alter table public.payroll_holiday_import_candidates enable row level security;
alter table public.payroll_holiday_import_events enable row level security;
revoke all on public.payroll_holiday_import_candidates,public.payroll_holiday_import_events from public,anon,authenticated;
create function public.payroll_holiday_candidate_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if current_setting('feedx.holiday_candidate_command',true) is distinct from 'yes' then raise exception using errcode='42501',message='Use controlled import commands.'; end if;
 if tg_op='DELETE' or (tg_table_name='payroll_holiday_import_events' and tg_op<>'INSERT') then raise exception 'Import evidence is retained.'; end if;
 if tg_op='UPDATE' and (new.source_pdf is distinct from old.source_pdf or new.source_sha256 is distinct from old.source_sha256
  or new.source_url is distinct from old.source_url or new.source_reference is distinct from old.source_reference
  or new.is_qa is distinct from old.is_qa or new.year<>old.year or new.request_id<>old.request_id
  or new.filename<>old.filename or new.fingerprint<>old.fingerprint or new.actor_employee_id<>old.actor_employee_id or new.created_at<>old.created_at
  or (old.status in ('published','retired') and (new.status<>'retired' or new.rows<>old.rows or new.decisions<>old.decisions or new.published_calendar_id is distinct from old.published_calendar_id))) then raise exception 'Source and published evidence are immutable.'; end if;
 return new;
end $$;
create trigger holiday_candidate_guard before insert or update or delete on public.payroll_holiday_import_candidates for each row execute function public.payroll_holiday_candidate_guard();
create trigger holiday_candidate_event_guard before insert or update or delete on public.payroll_holiday_import_events for each row execute function public.payroll_holiday_candidate_guard();

create function public.payroll_holiday_candidate_capture(p_year integer,p_url text,p_reference text,p_filename text,p_pdf_base64 text,p_request_id uuid,p_is_qa boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); bytes bytea; digest text; f text; c public.payroll_holiday_import_candidates%rowtype; baseline uuid;
begin
 if p_request_id is null or p_year is null or p_pdf_base64 is null or p_year not between 2000 and 2200 or nullif(btrim(p_reference),'') is null or nullif(btrim(p_filename),'') is null
  or p_is_qa is null or (not p_is_qa and coalesce(p_url,'') !~ '^https://([a-zA-Z0-9-]+\.)*gov\.my(/|$)')
  or (p_is_qa and p_reference not like 'QA ONLY%') then raise exception 'Provide an official government HTTPS reference and source PDF.'; end if;
 if length(p_pdf_base64)>7000000 then raise exception 'PDF must be at most 5 MB.'; end if;
 bytes:=decode(p_pdf_base64,'base64');
 if octet_length(bytes) not between 5 and 5242880 or substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'A PDF source document up to 5 MB is required.'; end if;
 digest:=encode(extensions.digest(bytes,'sha256'),'hex');
 f:=encode(extensions.digest(jsonb_build_array(p_year,p_url,p_reference,p_filename,digest,p_is_qa)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext('holiday-capture:'||p_request_id));
 select * into c from public.payroll_holiday_import_candidates where request_id=p_request_id;
 if found then if c.fingerprint<>f then raise exception 'Request identity has different source content.'; end if; return c.id; end if;
 select id into baseline from public.payroll_holiday_calendar_versions where year=p_year order by revision desc limit 1;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 insert into public.payroll_holiday_import_candidates(year,source_url,source_reference,filename,source_pdf,source_sha256,is_qa,status,baseline_id,request_id,fingerprint,actor_employee_id)
 values(p_year,coalesce(p_url,''),btrim(p_reference),p_filename,bytes,digest,p_is_qa,'fetched',baseline,p_request_id,f,a) returning * into c;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(c.id,'source_captured',a,jsonb_build_object('sha256',digest,'method','admin_uploaded_official_document','qa_only',p_is_qa));
 return c.id;
end $$;

create function public.payroll_holiday_candidate_parse(p_id uuid,p_rows jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype; r jsonb; old jsonb; baseline jsonb:='[]'; output jsonb:='[]'; seen text[]:='{}'; matched uuid[]:='{}'; key text; issue text; state text; n integer:=0; d date; f text;
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if not found then raise exception 'Import candidate not found.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Provide 1–500 verified transcription rows.'; end if;
 f:=encode(extensions.digest(p_rows::text,'sha256'),'hex');
 if c.parse_fingerprint=f then return; end if;
 if c.status<>'fetched' then raise exception 'Create a new candidate for changed transcription.'; end if;
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
  state:=case when old is null then 'new' when old->'holiday'->>'holiday_date'=d::text and old->'holiday'->>'name'=btrim(r->>'name') and old->'holiday'->>'scope'=r->>'scope' and nullif(old->'holiday'->>'state_code','') is not distinct from nullif(r->>'state_code','') and nullif(old->>'substitutes_holiday_id','') is not distinct from nullif(r->>'substitutes_holiday_id','') and (old->>'kind'='required' or old->>'kind'=coalesce(r->>'kind','gazetted')) then 'matched' else 'changed' end;
  if old is not null then
   if (old->>'holiday_id')::uuid=any(matched) then issue:='Conflicting corrections for one holiday'; end if;
   matched:=array_append(matched,(old->>'holiday_id')::uuid);
   if old->>'kind'='required' and state='changed' then issue:='Required holiday correction needs separate authority review'; end if;
  end if;
  if r->>'kind'='substitute' and not exists(select 1 from public.payroll_public_holidays h where h.id::text=r->>'substitutes_holiday_id' and extract(year from h.holiday_date)::integer=c.year and h.holiday_date<>d) then issue:='Identify the supported same-year original holiday'; end if;
  output:=output||jsonb_build_array(jsonb_build_object('key',n::text,'state',case when issue is null then state else 'blocked' end,'issue',issue,'previous',old,
   'row',jsonb_build_object('date',d,'name',btrim(r->>'name'),'scope',r->>'scope','state_code',nullif(r->>'state_code',''),'kind',case when state='matched' and old->>'kind'='required' then 'required' else coalesce(r->>'kind','gazetted') end,'source_reference',c.source_reference||' · '||(r->>'source_locator'),'substitutes_holiday_id',r->>'substitutes_holiday_id')));
 end loop;
 for old in select value from jsonb_array_elements(baseline) where not ((value->>'holiday_id')::uuid=any(matched)) loop
  n:=n+1; output:=output||jsonb_build_array(jsonb_build_object('key',n::text,'state','missing','previous',old,'issue','Not present in source; retain unless separately corrected'));
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set status='needs_review',rows=output,parser_version='verified_manifest_v1',parse_fingerprint=f,revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'parsed',a,jsonb_build_object('parser','verified_manifest_v1','input_sha256',f)),(p_id,'needs_review',a,jsonb_build_object('rows',output));
end $$;

create function public.payroll_holiday_candidate_review(p_id uuid,p_revision integer,p_decisions jsonb,p_approve boolean)
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
  if p_approve and (r->>'state'='blocked' or (r->>'state' in ('new','changed') and action is distinct from 'accept') or (r->>'state'='missing' and action is distinct from 'retain')) then raise exception 'Resolve every exception; missing records must be explicitly retained.'; end if;
  if r->>'state'='changed' and action='accept' and nullif(btrim(p_decisions->(r->>'key')->>'remark'),'') is null then raise exception 'Explain the source correction.'; end if;
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set decisions=p_decisions,status=case when p_approve then 'approved' else 'needs_review' end,revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,case when p_approve then 'approved' else 'review_saved' end,a,jsonb_build_object('decisions',p_decisions,'complete_source_review',p_approve));
end $$;

create function public.payroll_holiday_candidate_publish(p_id uuid,p_revision integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype; r jsonb; h uuid; entries jsonb:='[]'; result uuid;
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if not found then raise exception 'Candidate not found.'; end if;
 if c.status='published' then return c.published_calendar_id; end if;
 if c.status<>'approved' or c.revision<>p_revision then raise exception 'Approve the current candidate before publication.'; end if;
 -- QA imports may not replace any live operational source calendar.
 if c.is_qa and exists(select 1 from public.payroll_holiday_calendar_versions v where v.year=c.year and v.status='published'
  and not exists(select 1 from public.payroll_holiday_policy_events e where e.calendar_version_id=v.id and e.event_type='calendar_retired')
  and v.source_reference not like 'QA ONLY%') then raise exception 'QA imports cannot replace an operational annual calendar.'; end if;
 for r in select value from jsonb_array_elements(c.rows) loop
  if r->>'state' in ('matched','missing') then entries:=entries||jsonb_build_array(r->'previous');
  else
   select id into h from public.payroll_public_holidays where holiday_date=(r->'row'->>'date')::date and lower(name)=lower(r->'row'->>'name') and scope=r->'row'->>'scope' and state_code is not distinct from nullif(r->'row'->>'state_code','') and legal_entity_id is null;
   if h is null then h:=public.payroll_holiday_save((r->'row'->>'date')::date,r->'row'->>'name',r->'row'->>'scope',r->'row'->>'source_reference',null,r->'row'->>'state_code',null); end if;
   entries:=entries||jsonb_build_array(jsonb_build_object('holiday_id',h,'kind',r->'row'->>'kind','source_reference',r->'row'->>'source_reference','substitutes_holiday_id',r->'row'->>'substitutes_holiday_id'));
  end if;
 end loop;
 result:=public.payroll_holiday_calendar_save(c.year,entries,c.source_reference,true,true,c.baseline_id,c.id);
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set status='published',published_calendar_id=result,revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'published',a,jsonb_build_object('calendar_version_id',result,'source_sha256',c.source_sha256));
 return result;
end $$;

create function public.payroll_holiday_candidate_read(p_year integer,p_include_qa boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); begin
 return coalesce((select jsonb_agg((to_jsonb(c)-'source_pdf')||jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(e) order by occurred_at),'[]') from public.payroll_holiday_import_events e where e.candidate_id=c.id)) order by c.created_at desc) from public.payroll_holiday_import_candidates c where c.year=p_year and c.status<>'retired' and (not c.is_qa or p_include_qa)),'[]');
end $$;
create function public.payroll_holiday_candidate_source(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); begin
 return (select jsonb_build_object('filename',filename,'base64',encode(source_pdf,'base64'),'sha256',source_sha256,'reference',source_reference,'url',source_url) from public.payroll_holiday_import_candidates where id=p_id);
end $$;
create function public.payroll_holiday_candidate_retire(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); begin
 if nullif(btrim(p_reason),'') is null then raise exception 'Retirement reason required.'; end if;
 perform 1 from public.payroll_holiday_import_candidates where id=p_id and status<>'retired' for update;
 if not found then return; end if;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set status='retired',revision=revision+1 where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'retired',a,jsonb_build_object('reason',p_reason));
end $$;
revoke all on function public.payroll_holiday_candidate_guard() from public,anon,authenticated;
revoke all on function public.payroll_holiday_candidate_capture(integer,text,text,text,text,uuid,boolean),public.payroll_holiday_candidate_parse(uuid,jsonb),public.payroll_holiday_candidate_review(uuid,integer,jsonb,boolean),public.payroll_holiday_candidate_publish(uuid,integer),public.payroll_holiday_candidate_read(integer,boolean),public.payroll_holiday_candidate_source(uuid),public.payroll_holiday_candidate_retire(uuid,text) from public,anon;
grant execute on function public.payroll_holiday_candidate_capture(integer,text,text,text,text,uuid,boolean),public.payroll_holiday_candidate_parse(uuid,jsonb),public.payroll_holiday_candidate_review(uuid,integer,jsonb,boolean),public.payroll_holiday_candidate_publish(uuid,integer),public.payroll_holiday_candidate_read(integer,boolean),public.payroll_holiday_candidate_source(uuid),public.payroll_holiday_candidate_retire(uuid,text) to authenticated;
