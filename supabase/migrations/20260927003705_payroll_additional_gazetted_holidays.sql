-- Additional mandatory entitlement is separately reviewed; never inferred from
-- calendar kind/name, and never consumes a Company's six base selections.
create table public.payroll_additional_holiday_confirmations (
 id uuid primary key default gen_random_uuid(), year integer not null,
 candidate_id uuid not null references public.payroll_holiday_import_candidates(id),
 row_key text not null, holiday_id uuid not null references public.payroll_public_holidays(id),
 entry jsonb not null, entitlement_reference text not null,
 source_sha256 text not null, actor_employee_id uuid not null references public.employees(id),
 confirmed_at timestamptz not null default clock_timestamp(),
 request_id uuid not null unique, fingerprint text not null,
 unique(candidate_id,row_key), unique(holiday_id)
);
alter table public.payroll_additional_holiday_confirmations enable row level security;
revoke all on public.payroll_additional_holiday_confirmations from public,anon,authenticated;
create trigger additional_holiday_guard before insert or update or delete on public.payroll_additional_holiday_confirmations
 for each row execute function public.payroll_holiday_authority_guard();
create index additional_holiday_year_idx on public.payroll_additional_holiday_confirmations(year);
alter table public.payroll_paid_holiday_policy_versions add column additional_entries jsonb not null default '[]'
 check(jsonb_typeof(additional_entries)='array');

-- Extend the single existing publication owner. Old versions retain [], while
-- new publication snapshots confirmed additions (not a live mutable overlay).
do $$ declare d text; begin
 d:=pg_get_functiondef('public.payroll_paid_holiday_policy_save(text,uuid,uuid[],uuid[],uuid[],text,boolean,uuid,uuid)'::regprocedure);
 if position('calendar_version_id,status,selected_holiday_ids,legal_entity_ids,outlet_ids,override_reason,' in d)=0 then raise exception 'Policy insert contract changed'; end if;
 d:=replace(d,'calendar_version_id,status,selected_holiday_ids,legal_entity_ids,outlet_ids,override_reason,',
 'calendar_version_id,status,selected_holiday_ids,legal_entity_ids,outlet_ids,override_reason,additional_entries,');
 if position($s$nullif(btrim(p_override_reason),''),p_request_id,v_fingerprint,a)$s$ in d)=0 then raise exception 'Policy value contract changed'; end if;
 d:=replace(d,$s$nullif(btrim(p_override_reason),''),p_request_id,v_fingerprint,a)$s$,
 $s$nullif(btrim(p_override_reason),''),(select coalesce(jsonb_agg(entry order by confirmed_at,id),'[]') from public.payroll_additional_holiday_confirmations where year=c.year),p_request_id,v_fingerprint,a)$s$);
 execute d;
 d:=pg_get_functiondef('public.payroll_paid_holiday_resolve(uuid,uuid,date)'::regprocedure);
 if position('jsonb_array_elements(c.entries)' in d)=0 then raise exception 'Holiday resolver contract changed'; end if;
 d:=replace(d,'jsonb_array_elements(c.entries)','jsonb_array_elements(c.entries || p.additional_entries)');
 if position('if not ((e->>''holiday_id'')::uuid=any(p.selected_holiday_ids)) then continue; end if;' in d)=0 then raise exception 'Holiday selection contract changed'; end if;
 d:=replace(d,'if not ((e->>''holiday_id'')::uuid=any(p.selected_holiday_ids)) then continue; end if;',
 'if e->>''kind''<>''additional_mandatory'' and not ((e->>''holiday_id'')::uuid=any(p.selected_holiday_ids)) then continue; end if;');
 execute d;
 d:=pg_get_functiondef('public.payroll_annual_holiday_read(integer)'::regprocedure);
 if position('return result;' in d)=0 then raise exception 'Annual read contract changed'; end if;
 d:=replace(d,'return result;',$s$return result || jsonb_build_object('additional_entries',(select coalesce(jsonb_agg(entry order by confirmed_at,id),'[]') from public.payroll_additional_holiday_confirmations where year=p_year));$s$);
 execute d;
 d:=pg_get_functiondef('public.payroll_holiday_candidate_read(integer,boolean)'::regprocedure);
 if position($s$jsonb_build_object('history'$s$ in d)=0 then raise exception 'Candidate read contract changed'; end if;
 d:=replace(d,$s$jsonb_build_object('history'$s$, $s$jsonb_build_object('additional_confirmations',(select coalesce(jsonb_object_agg(row_key,entry),'{}') from public.payroll_additional_holiday_confirmations where candidate_id=c.id),'history'$s$);
 execute d;
end $$;

create function public.payroll_additional_holiday_confirm(p_candidate_id uuid,p_row_key text,p_entitlement_reference text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_import_candidates%rowtype;
 r jsonb; h uuid; result uuid; f text; previous public.payroll_additional_holiday_confirmations%rowtype;
 snapshot jsonb; p record; revised uuid; confirmed timestamptz:=clock_timestamp();
begin
 select * into c from public.payroll_holiday_import_candidates where id=p_candidate_id for update;
 if c.id is null or c.status='retired' or c.is_qa or p_request_id is null or nullif(btrim(p_entitlement_reference),'') is null then
  raise exception 'Provide captured source and explicit authoritative paid-entitlement evidence.'; end if;
 select value into r from jsonb_array_elements(c.rows) where value->>'key'=p_row_key;
 if r is null or r->'row'->>'kind'<>'special' or r->'row'->>'scope' not in ('national','state') then
  raise exception 'Only a source-reviewed special declaration can be confirmed here.'; end if;
 -- A separate explicit legal review can resolve entitlement uncertainty, not
 -- invalid dates, jurisdiction or conflicting source data.
 if r->>'state'='blocked' and coalesce(r->>'issue','') not like 'Additional s8 paid entitlement%' then
  raise exception 'Resolve source/date/jurisdiction uncertainty before entitlement review.'; end if;
 f:=md5(jsonb_build_array(p_candidate_id,p_row_key,p_entitlement_reference)::text);
 perform pg_advisory_xact_lock(hashtextextended('payroll_holiday_year:'||c.year,0));
 select * into previous from public.payroll_additional_holiday_confirmations where request_id=p_request_id or (candidate_id=c.id and row_key=p_row_key);
 if found then
  if previous.fingerprint<>f then raise exception 'Additional holiday already confirmed with different evidence.'; end if;
  return previous.id;
 end if;
 if extract(year from (r->'row'->>'date')::date)::integer<>c.year then raise exception 'Invalid source year.'; end if;
 select id into h from public.payroll_public_holidays where holiday_date=(r->'row'->>'date')::date
  and lower(name)=lower(r->'row'->>'name') and scope=r->'row'->>'scope'
  and state_code is not distinct from nullif(r->'row'->>'state_code','') and legal_entity_id is null;
 if h is null then h:=public.payroll_holiday_save((r->'row'->>'date')::date,r->'row'->>'name',r->'row'->>'scope',r->'row'->>'source_reference',null,r->'row'->>'state_code',null); end if;
 result:=gen_random_uuid();
 snapshot:=jsonb_build_object('confirmation_id',result,'confirmed_at',confirmed,'holiday_id',h,'kind','additional_mandatory','holiday',(select to_jsonb(v) from public.payroll_public_holidays v where id=h),
  'source_reference',r->'row'->>'source_reference','source_sha256',c.source_sha256,'candidate_id',c.id,'entitlement_reference',btrim(p_entitlement_reference),'actor_employee_id',a);
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_additional_holiday_confirmations(id,year,candidate_id,row_key,holiday_id,entry,entitlement_reference,source_sha256,actor_employee_id,confirmed_at,request_id,fingerprint)
 values(result,c.year,c.id,p_row_key,h,snapshot,btrim(p_entitlement_reference),c.source_sha256,a,confirmed,p_request_id,f);
 -- Explicit confirmation advances each current assignment to a new immutable
 -- policy revision. Optional selections, company scope and calendar stay pinned.
 for p in select distinct v.* from public.payroll_paid_holiday_assignments assignment
  join public.payroll_paid_holiday_policy_versions v on v.id=assignment.policy_version_id where v.year=c.year loop
  revised:=public.payroll_paid_holiday_policy_save(p.name,p.calendar_version_id,p.selected_holiday_ids,p.legal_entity_ids,p.outlet_ids,p.override_reason,true,p.id,gen_random_uuid());
  if exists(select 1 from public.payroll_holiday_policy_events where policy_version_id=p.id and event_type='company_default_published') then
   insert into public.payroll_holiday_policy_events(policy_version_id,event_type,actor_employee_id,details)
    values(revised,'company_default_published',a,jsonb_build_object('additional_confirmation_id',result,'supersedes_id',p.id)); end if;
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details)
 values(c.id,'additional_mandatory_confirmed',a,jsonb_build_object('confirmation_id',result,'row_key',p_row_key,'entry',snapshot));
 return result;
end $$;
revoke all on function public.payroll_additional_holiday_confirm(uuid,text,text,uuid) from public,anon;
grant execute on function public.payroll_additional_holiday_confirm(uuid,text,text,uuid) to authenticated;

create function public.payroll_additional_holiday_master_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from public.payroll_additional_holiday_confirmations where holiday_id=old.id) then
  raise exception 'Confirmed additional holiday evidence is immutable; use a separately reviewed correction.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger additional_holiday_master_guard before update or delete on public.payroll_public_holidays
 for each row execute function public.payroll_additional_holiday_master_guard();
revoke all on function public.payroll_additional_holiday_master_guard() from public,anon,authenticated;
