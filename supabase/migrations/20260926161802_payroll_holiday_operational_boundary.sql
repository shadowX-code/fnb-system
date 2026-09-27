-- Operational adapters delegate to the existing calendar, company-selection and
-- PH-benefit commands. No date generation, scraping or payroll/leave rule change.
create function public.payroll_holiday_calendar_retire(p_calendar_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor();
begin
 perform pg_advisory_xact_lock(hashtextextended('payroll_holiday_year:'||(select year from public.payroll_holiday_calendar_versions where id=p_calendar_id),0));
 if nullif(btrim(p_reason),'') is null or not exists(select 1 from public.payroll_holiday_calendar_versions where id=p_calendar_id) then
  raise exception using errcode='22023',message='Calendar and retirement reason required.'; end if;
 if exists(select 1 from public.payroll_paid_holiday_policy_versions p join public.legal_entities le on le.id=any(p.legal_entity_ids)
   where p.calendar_version_id=p_calendar_id and le.is_active) then
  raise exception using errcode='55000',message='A calendar linked to an active company cannot be retired.'; end if;
 if exists(select 1 from public.payroll_holiday_policy_events where calendar_version_id=p_calendar_id and event_type='calendar_retired') then return; end if;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_holiday_policy_events(calendar_version_id,event_type,actor_employee_id,details)
 values(p_calendar_id,'calendar_retired',a,jsonb_build_object('reason',btrim(p_reason)));
end $$;

-- Retirement affects future authoring only. Historical resolver/assignments,
-- published definitions, Payroll snapshots and Leave evidence remain unchanged.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.payroll_holiday_calendar_save(integer,jsonb,text,boolean,boolean,uuid,uuid)'::regprocedure);
 if position('c.status=''published'' and required' in definition)=0 then raise exception 'Calendar guard contract changed'; end if;
 definition:=replace(definition,'c.status=''published'' and required','c.status=''published'' and not exists(select 1 from public.payroll_holiday_policy_events retired where retired.calendar_version_id=c.id and retired.event_type=''calendar_retired'') and required');
 execute definition;
end $$;

create or replace function public.payroll_annual_holiday_read(p_year integer)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a uuid:=public.payroll_admin_actor(); result jsonb;
begin
 if not public.current_user_has_permission('payroll.view') then raise exception using errcode='42501',message='Payroll view authority required.'; end if;
 select jsonb_build_object(
 'calendars',coalesce((select jsonb_agg(to_jsonb(c) order by c.revision desc) from public.payroll_holiday_calendar_versions c where year=p_year
   and not exists(select 1 from public.payroll_holiday_policy_events e where e.calendar_version_id=c.id and e.event_type='calendar_retired')),'[]'::jsonb),
 'previous_calendar_id',(select id from public.payroll_holiday_calendar_versions where year=p_year order by revision desc limit 1),
 'policies',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('is_default',exists(select 1 from public.payroll_holiday_policy_events e where e.policy_version_id=p.id and e.event_type='company_default_published')) order by p.created_at desc)
   from public.payroll_paid_holiday_policy_versions p where year=p_year and public.current_user_has_all_outlet_access()
   and exists(select 1 from public.legal_entities le where le.is_active and le.id=any(p.legal_entity_ids))),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc) from public.payroll_holiday_policy_events e
   left join public.payroll_holiday_calendar_versions c on c.id=e.calendar_version_id
   left join public.payroll_paid_holiday_policy_versions p on p.id=e.policy_version_id
   where coalesce(c.year,p.year)=p_year and public.current_user_has_all_outlet_access()),'[]'::jsonb),
 'can_manage',public.current_user_has_permission('payroll.manage') and public.current_user_has_all_outlet_access()
   and exists(select 1 from public.employees e join public.roles r on r.id=e.role_id where e.id=a and lower(r.name) in ('owner','admin')))
 into result;
 return result;
end $$;

-- Import a reviewed structured manifest, not an asserted official feed. Source
-- URL plus server SHA-256 of the manifest are pinned in the publication event.
-- A special/substitute entry must carry its own gazette reference/classification.
create function public.payroll_holiday_import(p_year integer,p_manifest jsonb,p_publish boolean,p_previous_id uuid,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); r jsonb; h public.payroll_public_holidays%rowtype;
 entries jsonb:='[]'; ids uuid[]:='{}'; result uuid; fingerprint text; old_event jsonb;
 source text:=nullif(btrim(p_manifest->>'source_reference'),''); kind text; original uuid;
begin
 if p_request_id is null or source is null or jsonb_typeof(p_manifest->'holidays') is distinct from 'array'
  or jsonb_array_length(p_manifest->'holidays') not between 1 and 500 or p_year not between 2000 and 2200 then
  raise exception using errcode='22023',message='Provide year, authoritative source and 1–500 reviewed holiday rows.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('year',p_year,'manifest',p_manifest,'publish',p_publish,'previous',p_previous_id)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('payroll_holiday_year:'||p_year,0));
 select e.details into old_event from public.payroll_holiday_policy_events e join public.payroll_holiday_calendar_versions c on c.id=e.calendar_version_id
  where c.request_id=p_request_id and e.event_type='calendar_imported';
 if found then
  if old_event->>'fingerprint'<>fingerprint then raise exception using errcode='22023',message='Import request identity has different content.'; end if;
  return (select id from public.payroll_holiday_calendar_versions where request_id=p_request_id); end if;
 for r in select value from jsonb_array_elements(p_manifest->'holidays') loop
  if extract(year from (r->>'date')::date)::integer<>p_year or coalesce(r->>'scope','') not in ('national','state') then
   raise exception using errcode='22023',message='Each imported holiday must match the year and National/State scope.'; end if;
  kind:=r->>'kind';
  if coalesce(kind,'') not in ('required','gazetted','special','substitute') then
   raise exception using errcode='22023',message='An unresolved holiday needs source review before import.'; end if;
  select * into h from public.payroll_public_holidays where holiday_date=(r->>'date')::date and lower(name)=lower(btrim(r->>'name'))
   and scope=r->>'scope' and state_code is not distinct from nullif(r->>'state_code','') and legal_entity_id is null;
  if h.id is null then
   h.id:=public.payroll_holiday_save((r->>'date')::date,r->>'name',r->>'scope',coalesce(nullif(r->>'source_reference',''),source),null,nullif(r->>'state_code',''),null);
  end if;
  if h.id=any(ids) then raise exception using errcode='22023',message='Duplicate holiday in import.'; end if;
  ids:=array_append(ids,h.id);
  original:=nullif(r->>'substitutes_holiday_id','')::uuid;
  entries:=entries||jsonb_build_array(jsonb_build_object('holiday_id',h.id,'kind',kind,'source_reference',coalesce(nullif(r->>'source_reference',''),source),'substitutes_holiday_id',original));
 end loop;
 result:=public.payroll_holiday_calendar_save(p_year,entries,source,coalesce((p_manifest->>'source_complete')::boolean,false),p_publish,p_previous_id,p_request_id);
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_holiday_policy_events(calendar_version_id,event_type,actor_employee_id,details)
 values(result,'calendar_imported',a,jsonb_build_object('source_reference',source,'manifest_sha256',encode(extensions.digest(p_manifest::text,'sha256'),'hex'),'manifest',p_manifest,'fingerprint',fingerprint));
 return result;
end $$;

create function public.payroll_paid_holiday_default_save(p_calendar_id uuid,p_selected uuid[],p_previous_id uuid,p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); entities uuid[]; result uuid;
begin
 select array_agg(id order by id) into entities from public.legal_entities where is_active;
 if entities is null then raise exception using errcode='22023',message='Create an active Legal Entity first.'; end if;
 -- Existing exceptions and frozen scope are intentionally not reassigned here.
 result:=public.payroll_paid_holiday_policy_save('Company Paid Holidays',p_calendar_id,p_selected,entities,'{}',null,true,p_previous_id,p_request_id);
 perform set_config('feedx.payroll_command','yes',true);
 if not exists(select 1 from public.payroll_holiday_policy_events where policy_version_id=result and event_type='company_default_published') then
  insert into public.payroll_holiday_policy_events(policy_version_id,event_type,actor_employee_id,details)
  values(result,'company_default_published',a,jsonb_build_object('applies_to','all_active_companies','legal_entity_ids',entities)); end if;
 return result;
end $$;

revoke all on function public.payroll_holiday_calendar_retire(uuid,text),public.payroll_holiday_import(integer,jsonb,boolean,uuid,uuid),public.payroll_paid_holiday_default_save(uuid,uuid[],uuid,uuid) from public,anon;
grant execute on function public.payroll_holiday_calendar_retire(uuid,text),public.payroll_holiday_import(integer,jsonb,boolean,uuid,uuid),public.payroll_paid_holiday_default_save(uuid,uuid[],uuid,uuid) to authenticated;

create function public.payroll_ph_default_policy_save(p_effective_from date,p_treatment text,p_remark text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); le record; ids jsonb:='[]';
begin
 -- One transaction; every entity retains its canonical effective-dated policy.
 -- Each owning command rechecks finalized-period and policy-date guards.
 for le in select id from public.legal_entities where is_active order by id loop
  ids:=ids||jsonb_build_array(public.payroll_ph_policy_save(le.id,p_effective_from,p_treatment,p_remark));
 end loop;
 if jsonb_array_length(ids)=0 then raise exception using errcode='22023',message='Create an active Legal Entity first.'; end if;
 return ids;
end $$;
revoke all on function public.payroll_ph_default_policy_save(date,text,text) from public,anon;
grant execute on function public.payroll_ph_default_policy_save(date,text,text) to authenticated;
