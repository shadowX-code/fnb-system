-- FeedX Crew Localized Content Layer
-- Shared, version-bound business-content localization for SOP, Onboarding and Tasks.
-- UI strings remain in the frontend i18n catalog. Published/active versions are immutable.

create table public.crew_localized_content_units (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain in ('sop','onboarding','task')),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  version_id uuid not null,
  unit_key text not null check (unit_key ~ '^[a-z0-9_.:-]{2,240}$'),
  field_kind text not null default 'plain_text' check (field_kind in ('plain_text','rich_text','image_caption')),
  source_language text not null check (source_language in ('en','zh-CN','ms')),
  source_value jsonb not null,
  source_revision integer not null default 1 check (source_revision > 0),
  source_hash text not null,
  created_by uuid references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(domain, version_id, unit_key),
  check (jsonb_typeof(source_value) in ('string','object','array'))
);

create table public.crew_localized_content_translations (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.crew_localized_content_units(id) on delete cascade,
  language_code text not null check (language_code in ('en','zh-CN','ms')),
  translated_value jsonb not null,
  status text not null check (status in ('ai_translated','reviewed','outdated')),
  provider text,
  model text,
  generated_by uuid references auth.users(id) on delete restrict,
  generated_at timestamptz,
  source_revision integer not null,
  source_hash text not null,
  manually_edited_at timestamptz,
  manually_edited_by uuid references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unit_id, language_code),
  check (jsonb_typeof(translated_value) in ('string','object','array'))
);

create table public.crew_localized_content_audit (
  id bigint generated always as identity primary key,
  unit_id uuid references public.crew_localized_content_units(id) on delete restrict,
  domain text not null,
  version_id uuid not null,
  action text not null check (action in ('source_saved','source_language_changed','translation_generated','translation_edited','translation_reviewed','version_cloned')),
  source_language text,
  target_language text,
  source_revision integer,
  source_hash text,
  provider text,
  model text,
  actor_id uuid references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index crew_localized_units_version_idx on public.crew_localized_content_units(domain,version_id,unit_key);
create index crew_localized_units_outlet_idx on public.crew_localized_content_units(outlet_id,domain,updated_at desc);
create index crew_localized_translations_unit_idx on public.crew_localized_content_translations(unit_id,language_code,status);
create index crew_localized_audit_version_idx on public.crew_localized_content_audit(domain,version_id,created_at desc);

alter table public.crew_localized_content_units enable row level security;
alter table public.crew_localized_content_translations enable row level security;
alter table public.crew_localized_content_audit enable row level security;
revoke all on public.crew_localized_content_units, public.crew_localized_content_translations, public.crew_localized_content_audit from public, anon, authenticated;
grant select,insert,update,delete on public.crew_localized_content_units, public.crew_localized_content_translations to service_role;
grant select,insert on public.crew_localized_content_audit to service_role;

alter table public.crew_sop_versions add column if not exists localized_content_snapshot jsonb;
alter table public.crew_journeys add column if not exists localized_content_snapshot jsonb;
alter table public.crew_operation_templates add column if not exists localized_content_snapshot jsonb;

create or replace function public.crew_localization_version_context(p_domain text,p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare result jsonb;
begin
  if p_domain='sop' then
    select jsonb_build_object('outlet_id',s.outlet_id,'status',v.status,'permission','crew_sop.manage') into result
    from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=p_version_id;
  elsif p_domain='onboarding' then
    select jsonb_build_object('outlet_id',j.outlet_id,'status',j.status,'permission','crew_learning.manage') into result
    from public.crew_journeys j where j.id=p_version_id;
  elsif p_domain='task' then
    select jsonb_build_object('outlet_id',t.outlet_id,'status',t.status,'permission','crew_operations.manage') into result
    from public.crew_operation_templates t where t.id=p_version_id;
  else
    raise exception using errcode='22023',message='Unsupported localized content domain.';
  end if;
  if result is null then raise exception using errcode='22023',message='Localized content version was not found.'; end if;
  return result;
end; $$;
revoke all on function public.crew_localization_version_context(text,uuid) from public,anon,authenticated;

create or replace function public.crew_localization_assert_admin(p_domain text,p_version_id uuid,p_require_draft boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare context jsonb; editable boolean;
begin
  context:=public.crew_localization_version_context(p_domain,p_version_id);
  if not public.current_user_has_permission(context->>'permission')
     or not public.current_user_can_access_outlet((context->>'outlet_id')::uuid) then
    raise exception using errcode='42501',message='Localized content is unavailable for this outlet.';
  end if;
  editable:=case p_domain when 'task' then context->>'status'='draft' else context->>'status'='draft' end;
  if p_require_draft and not editable then
    raise exception using errcode='55000',message='Published content is immutable. Create or continue a Draft version.';
  end if;
  return context;
end; $$;
revoke all on function public.crew_localization_assert_admin(text,uuid,boolean) from public,anon,authenticated;

create or replace function public.crew_localization_snapshot(p_domain text,p_version_id uuid)
returns jsonb language sql stable security definer set search_path=public,extensions as $$
  select coalesce(jsonb_object_agg(u.unit_key,
    jsonb_build_object(
      'field_kind',u.field_kind,
      'source_language',u.source_language,
      'source_value',u.source_value,
      'source_revision',u.source_revision,
      'source_hash',u.source_hash,
      'translations',coalesce((
        select jsonb_object_agg(t.language_code,jsonb_build_object(
          'value',t.translated_value,'status',t.status,'source_revision',t.source_revision,'source_hash',t.source_hash,
          'generated_at',t.generated_at,'manually_edited_at',t.manually_edited_at,'reviewed_at',t.reviewed_at
        )) from public.crew_localized_content_translations t where t.unit_id=u.id
      ),'{}'::jsonb)
    ) order by u.unit_key
  ),'{}'::jsonb)
  from public.crew_localized_content_units u where u.domain=p_domain and u.version_id=p_version_id;
$$;
revoke all on function public.crew_localization_snapshot(text,uuid) from public,anon,authenticated;

create or replace function public.crew_localization_guard()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare unit public.crew_localized_content_units%rowtype; context jsonb;
begin
  if tg_table_name='crew_localized_content_units' then
    if tg_op='DELETE' then unit:=old; else unit:=new; end if;
  elsif tg_table_name='crew_localized_content_translations' then
    select * into unit from public.crew_localized_content_units where id=coalesce(new.unit_id,old.unit_id);
  end if;
  context:=public.crew_localization_version_context(unit.domain,unit.version_id);
  if context->>'status'<>'draft' then
    raise exception using errcode='55000',message='Published localized content is immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.crew_localization_guard() from public,anon,authenticated;
create trigger crew_localized_units_immutable before insert or update or delete on public.crew_localized_content_units for each row execute function public.crew_localization_guard();
create trigger crew_localized_translations_immutable before insert or update or delete on public.crew_localized_content_translations for each row execute function public.crew_localization_guard();

create or replace function public.crew_localization_freeze_version()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
begin
  if tg_table_name='crew_sop_versions' and new.status='published' and old.status='draft' then
    new.localized_content_snapshot:=public.crew_localization_snapshot('sop',new.id);
  elsif tg_table_name='crew_journeys' and new.status='published' and old.status='draft' then
    new.localized_content_snapshot:=public.crew_localization_snapshot('onboarding',new.id);
  elsif tg_table_name='crew_operation_templates' and new.status='active' and old.status='draft' then
    new.localized_content_snapshot:=public.crew_localization_snapshot('task',new.id);
  end if;
  return new;
end; $$;
revoke all on function public.crew_localization_freeze_version() from public,anon,authenticated;
create trigger zz_crew_sop_localization_freeze before update on public.crew_sop_versions for each row execute function public.crew_localization_freeze_version();
create trigger zz_crew_onboarding_localization_freeze before update on public.crew_journeys for each row execute function public.crew_localization_freeze_version();
create trigger zz_crew_task_localization_freeze before update on public.crew_operation_templates for each row execute function public.crew_localization_freeze_version();

create or replace function public.crew_localization_attach_frozen_snapshot()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare frozen jsonb;
begin
  if tg_table_name='crew_journey_assignments' then
    select j.localized_content_snapshot into frozen from public.crew_journeys j where j.id=new.journey_id;
    new.journey_snapshot:=jsonb_set(coalesce(new.journey_snapshot,'{}'::jsonb),'{localized_content}',coalesce(frozen,'{}'::jsonb),true);
  elsif tg_table_name='crew_operation_instances' then
    select t.localized_content_snapshot into frozen from public.crew_operation_templates t where t.id=new.template_id;
    new.template_snapshot:=jsonb_set(coalesce(new.template_snapshot,'{}'::jsonb),'{localized_content}',coalesce(frozen,'{}'::jsonb),true);
  end if;
  return new;
end; $$;
revoke all on function public.crew_localization_attach_frozen_snapshot() from public,anon,authenticated;
create trigger zz_crew_assignment_localization_snapshot before insert or update of journey_snapshot on public.crew_journey_assignments for each row execute function public.crew_localization_attach_frozen_snapshot();
create trigger zz_crew_task_instance_localization_snapshot before insert or update of template_snapshot on public.crew_operation_instances for each row execute function public.crew_localization_attach_frozen_snapshot();

create or replace function public.crew_admin_localized_content(p_domain text,p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare context jsonb;
begin
  context:=public.crew_localization_assert_admin(p_domain,p_version_id,false);
  return jsonb_build_object(
    'domain',p_domain,'version_id',p_version_id,'outlet_id',context->>'outlet_id','version_status',context->>'status',
    'languages',jsonb_build_array('en','zh-CN','ms'),'units',public.crew_localization_snapshot(p_domain,p_version_id)
  );
end; $$;
revoke all on function public.crew_admin_localized_content(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_admin_localized_content(text,uuid) to authenticated;

create or replace function public.crew_save_localized_content_units(p_domain text,p_version_id uuid,p_units jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare context jsonb; item jsonb; existing public.crew_localized_content_units%rowtype; v_unit_id uuid; next_hash text; next_revision integer; changed boolean;
begin
  context:=public.crew_localization_assert_admin(p_domain,p_version_id,true);
  if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)>500 then
    raise exception using errcode='22023',message='Localized content units must be a bounded array.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_units) x group by x->>'unit_key' having count(*)>1) then
    raise exception using errcode='22023',message='Localized content contains duplicate unit keys.';
  end if;
  for item in select * from jsonb_array_elements(p_units) loop
    if coalesce(item->>'unit_key','') !~ '^[a-z0-9_.:-]{2,240}$'
       or coalesce(item->>'field_kind','') not in ('plain_text','rich_text','image_caption')
       or coalesce(item->>'source_language','') not in ('en','zh-CN','ms')
       or item->'source_value' is null or jsonb_typeof(item->'source_value') not in ('string','object','array') then
      raise exception using errcode='22023',message='A localized content unit is invalid.';
    end if;
    if length((item->'source_value')::text)>100000 then raise exception using errcode='22023',message='A localized content unit is too large.'; end if;
    next_hash:=encode(extensions.digest(convert_to((item->'source_value')::text,'UTF8'),'sha256'),'hex');
    select * into existing from public.crew_localized_content_units where domain=p_domain and version_id=p_version_id and unit_key=item->>'unit_key';
    changed:=existing.id is null or existing.source_hash<>next_hash or existing.source_language<>item->>'source_language';
    next_revision:=case when existing.id is null then 1 when changed then existing.source_revision+1 else existing.source_revision end;
    insert into public.crew_localized_content_units(domain,outlet_id,version_id,unit_key,field_kind,source_language,source_value,source_revision,source_hash,created_by,updated_by)
    values(p_domain,(context->>'outlet_id')::uuid,p_version_id,item->>'unit_key',item->>'field_kind',item->>'source_language',item->'source_value',next_revision,next_hash,auth.uid(),auth.uid())
    on conflict(domain,version_id,unit_key) do update set field_kind=excluded.field_kind,source_language=excluded.source_language,source_value=excluded.source_value,source_revision=excluded.source_revision,source_hash=excluded.source_hash,updated_by=auth.uid(),updated_at=now()
    returning id into v_unit_id;
    if changed and existing.id is not null then
      update public.crew_localized_content_translations t
      set status='outdated',updated_at=now()
      where t.unit_id=v_unit_id and t.language_code<>(item->>'source_language');
    end if;
    if changed then
      insert into public.crew_localized_content_audit(unit_id,domain,version_id,action,source_language,source_revision,source_hash,actor_id)
      values(v_unit_id,p_domain,p_version_id,case when existing.id is not null and existing.source_language<>item->>'source_language' then 'source_language_changed' else 'source_saved' end,item->>'source_language',next_revision,next_hash,auth.uid());
    end if;
  end loop;
  return public.crew_admin_localized_content(p_domain,p_version_id);
end; $$;
revoke all on function public.crew_save_localized_content_units(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_save_localized_content_units(text,uuid,jsonb) to authenticated;

create or replace function public.crew_edit_localized_translation(p_unit_id uuid,p_language text,p_value jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare unit public.crew_localized_content_units%rowtype;
begin
  select * into unit from public.crew_localized_content_units where id=p_unit_id;
  if unit.id is null then raise exception using errcode='22023',message='Localized content unit was not found.'; end if;
  perform public.crew_localization_assert_admin(unit.domain,unit.version_id,true);
  if p_language not in ('en','zh-CN','ms') or p_language=unit.source_language or p_value is null or jsonb_typeof(p_value) not in ('string','object','array') then
    raise exception using errcode='22023',message='Translation value is invalid.';
  end if;
  insert into public.crew_localized_content_translations(unit_id,language_code,translated_value,status,source_revision,source_hash,manually_edited_at,manually_edited_by)
  values(unit.id,p_language,p_value,'reviewed',unit.source_revision,unit.source_hash,now(),auth.uid())
  on conflict(unit_id,language_code) do update set translated_value=excluded.translated_value,status='reviewed',source_revision=excluded.source_revision,source_hash=excluded.source_hash,manually_edited_at=now(),manually_edited_by=auth.uid(),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now();
  insert into public.crew_localized_content_audit(unit_id,domain,version_id,action,source_language,target_language,source_revision,source_hash,actor_id)
  values(unit.id,unit.domain,unit.version_id,'translation_edited',unit.source_language,p_language,unit.source_revision,unit.source_hash,auth.uid());
  return public.crew_admin_localized_content(unit.domain,unit.version_id);
end; $$;
revoke all on function public.crew_edit_localized_translation(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_edit_localized_translation(uuid,text,jsonb) to authenticated;

create or replace function public.crew_review_localized_translation(p_unit_id uuid,p_language text)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare unit public.crew_localized_content_units%rowtype; changed integer;
begin
  select * into unit from public.crew_localized_content_units where id=p_unit_id;
  if unit.id is null then raise exception using errcode='22023',message='Localized content unit was not found.'; end if;
  perform public.crew_localization_assert_admin(unit.domain,unit.version_id,true);
  update public.crew_localized_content_translations set status='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where unit_id=unit.id and language_code=p_language and status<>'outdated';
  get diagnostics changed=row_count;
  if changed<>1 then raise exception using errcode='22023',message='Only a current translation can be marked Reviewed.'; end if;
  insert into public.crew_localized_content_audit(unit_id,domain,version_id,action,source_language,target_language,source_revision,source_hash,actor_id)
  values(unit.id,unit.domain,unit.version_id,'translation_reviewed',unit.source_language,p_language,unit.source_revision,unit.source_hash,auth.uid());
  return public.crew_admin_localized_content(unit.domain,unit.version_id);
end; $$;
revoke all on function public.crew_review_localized_translation(uuid,text) from public,anon,authenticated;
grant execute on function public.crew_review_localized_translation(uuid,text) to authenticated;

create or replace function public.crew_prepare_localized_translation(p_domain text,p_version_id uuid,p_unit_ids uuid[] default null,p_target_languages text[] default null)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare result jsonb;
begin
  perform public.crew_localization_assert_admin(p_domain,p_version_id,true);
  if p_target_languages is not null and exists(select 1 from unnest(p_target_languages) x where x not in ('en','zh-CN','ms')) then
    raise exception using errcode='22023',message='Translation target language is invalid.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'unit_id',u.id,'unit_key',u.unit_key,'field_kind',u.field_kind,'source_language',u.source_language,
    'source_value',u.source_value,'source_revision',u.source_revision,'source_hash',u.source_hash,
    'targets',(select coalesce(jsonb_agg(languages.language_code),'[]'::jsonb) from unnest(array['en','zh-CN','ms']) as languages(language_code)
      left join public.crew_localized_content_translations t on t.unit_id=u.id and t.language_code=languages.language_code
      where languages.language_code<>u.source_language and (p_target_languages is null or languages.language_code=any(p_target_languages))
        and (t.id is null or t.status='outdated')),
    'protected_targets',(select coalesce(jsonb_agg(t.language_code),'[]'::jsonb) from public.crew_localized_content_translations t
      where t.unit_id=u.id and (t.manually_edited_at is not null or t.status='reviewed'))
  ) order by u.unit_key),'[]'::jsonb) into result
  from public.crew_localized_content_units u
  where u.domain=p_domain and u.version_id=p_version_id and (p_unit_ids is null or u.id=any(p_unit_ids));
  return jsonb_build_object('domain',p_domain,'version_id',p_version_id,'units',result);
end; $$;
revoke all on function public.crew_prepare_localized_translation(text,uuid,uuid[],text[]) from public,anon,authenticated;
grant execute on function public.crew_prepare_localized_translation(text,uuid,uuid[],text[]) to authenticated;

create or replace function public.crew_apply_localized_translations(p_domain text,p_version_id uuid,p_translations jsonb,p_provider text,p_model text)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare item jsonb; unit public.crew_localized_content_units%rowtype; current_translation public.crew_localized_content_translations%rowtype;
begin
  perform public.crew_localization_assert_admin(p_domain,p_version_id,true);
  if jsonb_typeof(p_translations)<>'array' or jsonb_array_length(p_translations)>1000 then raise exception using errcode='22023',message='Generated translations are invalid.'; end if;
  for item in select * from jsonb_array_elements(p_translations) loop
    select * into unit from public.crew_localized_content_units where id=(item->>'unit_id')::uuid and domain=p_domain and version_id=p_version_id;
    if unit.id is null or item->>'language' not in ('en','zh-CN','ms') or item->>'language'=unit.source_language
       or (item->>'source_revision')::integer<>unit.source_revision or item->>'source_hash'<>unit.source_hash
       or item->'value' is null or jsonb_typeof(item->'value') not in ('string','object','array') then
      raise exception using errcode='22023',message='A generated translation no longer matches its source revision.';
    end if;
    select * into current_translation from public.crew_localized_content_translations where unit_id=unit.id and language_code=item->>'language';
    if current_translation.id is not null and (current_translation.manually_edited_at is not null or current_translation.status='reviewed')
       and coalesce((item->>'replace_protected')::boolean,false) is not true then
      raise exception using errcode='55000',message='A translation contains manual edits. Confirm replacement before regenerating.';
    end if;
    insert into public.crew_localized_content_translations(unit_id,language_code,translated_value,status,provider,model,generated_by,generated_at,source_revision,source_hash)
    values(unit.id,item->>'language',item->'value','ai_translated',left(p_provider,80),left(p_model,120),auth.uid(),now(),unit.source_revision,unit.source_hash)
    on conflict(unit_id,language_code) do update set translated_value=excluded.translated_value,status='ai_translated',provider=excluded.provider,model=excluded.model,generated_by=auth.uid(),generated_at=now(),source_revision=excluded.source_revision,source_hash=excluded.source_hash,manually_edited_at=null,manually_edited_by=null,reviewed_by=null,reviewed_at=null,updated_at=now();
    insert into public.crew_localized_content_audit(unit_id,domain,version_id,action,source_language,target_language,source_revision,source_hash,provider,model,actor_id)
    values(unit.id,p_domain,p_version_id,'translation_generated',unit.source_language,item->>'language',unit.source_revision,unit.source_hash,left(p_provider,80),left(p_model,120),auth.uid());
  end loop;
  return public.crew_admin_localized_content(p_domain,p_version_id);
end; $$;
revoke all on function public.crew_apply_localized_translations(text,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.crew_apply_localized_translations(text,uuid,jsonb,text,text) to authenticated;

create or replace function public.crew_clone_localized_content(p_domain text,p_source_version_id uuid,p_target_version_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare source_context jsonb; target_context jsonb; old_unit public.crew_localized_content_units%rowtype; new_unit_id uuid;
begin
  source_context:=public.crew_localization_assert_admin(p_domain,p_source_version_id,false);
  target_context:=public.crew_localization_assert_admin(p_domain,p_target_version_id,true);
  if source_context->>'outlet_id'<>target_context->>'outlet_id' then raise exception using errcode='42501',message='Localized content cannot be copied across outlets.'; end if;
  if exists(select 1 from public.crew_localized_content_units where domain=p_domain and version_id=p_target_version_id) then return public.crew_admin_localized_content(p_domain,p_target_version_id); end if;
  for old_unit in select * from public.crew_localized_content_units where domain=p_domain and version_id=p_source_version_id order by unit_key loop
    insert into public.crew_localized_content_units(domain,outlet_id,version_id,unit_key,field_kind,source_language,source_value,source_revision,source_hash,created_by,updated_by)
    values(p_domain,old_unit.outlet_id,p_target_version_id,old_unit.unit_key,old_unit.field_kind,old_unit.source_language,old_unit.source_value,old_unit.source_revision,old_unit.source_hash,auth.uid(),auth.uid()) returning id into new_unit_id;
    insert into public.crew_localized_content_translations(unit_id,language_code,translated_value,status,provider,model,generated_by,generated_at,source_revision,source_hash,manually_edited_at,manually_edited_by,reviewed_by,reviewed_at)
    select new_unit_id,language_code,translated_value,status,provider,model,generated_by,generated_at,source_revision,source_hash,manually_edited_at,manually_edited_by,reviewed_by,reviewed_at
    from public.crew_localized_content_translations where unit_id=old_unit.id;
    insert into public.crew_localized_content_audit(unit_id,domain,version_id,action,source_language,source_revision,source_hash,actor_id,metadata)
    values(new_unit_id,p_domain,p_target_version_id,'version_cloned',old_unit.source_language,old_unit.source_revision,old_unit.source_hash,auth.uid(),jsonb_build_object('source_version_id',p_source_version_id));
  end loop;
  return public.crew_admin_localized_content(p_domain,p_target_version_id);
end; $$;
revoke all on function public.crew_clone_localized_content(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_clone_localized_content(text,uuid,uuid) to authenticated;

create or replace function public.crew_localized_content(p_token text,p_domain text,p_version_ids uuid[],p_language text)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare v_employee_id uuid; v_employee_outlet uuid; v_version_id uuid; allowed boolean; snapshot jsonb; unit_entry record; resolved jsonb; value jsonb; result jsonb:='{}'::jsonb;
begin
  if p_language not in ('en','zh-CN','ms') then p_language:='en'; end if;
  if coalesce(cardinality(p_version_ids),0)>100 then raise exception using errcode='22023',message='Too many localized content versions requested.'; end if;
  v_employee_id:=public.crew_session_employee(p_token);
  select ca.primary_outlet_id into v_employee_outlet
  from public.crew_access ca where ca.employee_id=v_employee_id and ca.access_state='active';
  if v_employee_outlet is null then raise exception using errcode='42501',message='Crew access is unavailable.'; end if;
  foreach v_version_id in array coalesce(p_version_ids,'{}'::uuid[]) loop
    allowed:=false;
    if p_domain='sop' then
      allowed:=exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=v_version_id and v.status='published' and s.outlet_id=v_employee_outlet);
    elsif p_domain='onboarding' then
      allowed:=exists(select 1 from public.crew_journey_assignments a where a.employee_id=v_employee_id and a.journey_id=v_version_id);
    elsif p_domain='task' then
      allowed:=exists(select 1 from public.crew_operation_instances i join public.crew_task_instance_assignees a on a.instance_id=i.id where a.employee_id=v_employee_id and i.template_id=v_version_id);
    else raise exception using errcode='22023',message='Unsupported localized content domain.';
    end if;
    if not allowed then raise exception using errcode='42501',message='Localized content is unavailable for this Crew session.'; end if;
    if p_domain='sop' then
      select v.localized_content_snapshot into snapshot from public.crew_sop_versions v where v.id=v_version_id;
    elsif p_domain='onboarding' then
      select a.journey_snapshot->'localized_content' into snapshot from public.crew_journey_assignments a
      where a.employee_id=v_employee_id and a.journey_id=v_version_id order by a.assigned_at desc limit 1;
    else
      select i.template_snapshot->'localized_content' into snapshot from public.crew_operation_instances i
      join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee_id
      where i.template_id=v_version_id order by i.business_date desc,i.created_at desc limit 1;
    end if;
    snapshot:=coalesce(snapshot,public.crew_localization_snapshot(p_domain,v_version_id));
    resolved:='{}'::jsonb;
    for unit_entry in select key,entry.value from jsonb_each(snapshot) entry loop
      value:=coalesce(unit_entry.value->'translations'->p_language->'value',
        case when unit_entry.value->>'source_language'=p_language then unit_entry.value->'source_value' end,
        unit_entry.value->'translations'->'en'->'value',
        case when unit_entry.value->>'source_language'='en' then unit_entry.value->'source_value' end,
        unit_entry.value->'source_value',
        (select candidate.value->'value' from jsonb_each(unit_entry.value->'translations') candidate limit 1));
      if value is not null then resolved:=resolved||jsonb_build_object(unit_entry.key,value); end if;
    end loop;
    result:=result||jsonb_build_object(v_version_id::text,resolved);
  end loop;
  return result;
end; $$;
revoke all on function public.crew_localized_content(text,text,uuid[],text) from public,anon,authenticated;
grant execute on function public.crew_localized_content(text,text,uuid[],text) to anon,authenticated;

-- Expose only the pinned template identifier needed to resolve the caller's own
-- localized Task snapshot. No raw snapshot or other employee data is returned.
create or replace function public.crew_tasks_detail(p_token text,p_instance_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=public,extensions as $$
declare ctx jsonb; v_employee uuid; instance public.crew_operation_instances%rowtype; assignee public.crew_task_instance_assignees%rowtype; blocks jsonb;
begin
  ctx:=public.crew_operations_employee_context(p_token);
  v_employee:=(ctx->>'employee_id')::uuid;
  select i.* into instance from public.crew_operation_instances i
  join public.crew_task_instance_assignees a on a.instance_id=i.id and a.employee_id=v_employee
  where i.id=p_instance_id;
  select a.* into assignee from public.crew_task_instance_assignees a where a.instance_id=instance.id and a.employee_id=v_employee;
  if instance.id is null or instance.outlet_id<>(ctx->>'outlet_id')::uuid then raise exception using errcode='42501',message='Task is unavailable.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'title',i.title,'description',i.description,'block_type',i.block_type,'config',i.block_config,
    'required',i.is_required,'sort_order',i.sort_order,'evidence_requirement',i.evidence_requirement,'health_category',i.health_category,
    'sop_reference',i.sop_reference,'status',coalesce(r.status,nullif(i.status,'pending'),'pending'),
    'response',coalesce(r.response,i.evidence,'{}'::jsonb),'exception_reason',coalesce(r.exception_reason,i.exception_reason),
    'note',coalesce(r.note,i.note),'completed_at',coalesce(r.completed_at,i.completed_at)
  ) order by i.sort_order),'[]'::jsonb) into blocks
  from public.crew_operation_instance_items i
  left join public.crew_task_item_responses r on r.instance_item_id=i.id and r.employee_id=v_employee
  where i.instance_id=instance.id;
  return jsonb_build_object(
    'id',instance.id,'template_id',instance.template_id,'name',instance.name,'task_type',instance.task_type,
    'schedule_type',instance.schedule_type,'priority',instance.priority,'status',assignee.status,'completed_at',assignee.completed_at,
    'available_from',instance.available_from,'due_at',instance.available_until,'allow_exception',instance.allow_exception,
    'exception_requires_reason',instance.exception_requires_reason,'manager_review_required',instance.manager_review_required,
    'completion_rule',instance.completion_rule,'blocks',blocks
  );
end; $$;
revoke all on function public.crew_tasks_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_tasks_detail(text,uuid) to anon,authenticated;

-- Existing content remains canonical in its current columns. The UI syncs it into
-- version-bound units on the first Draft save. Published history is untouched and
-- no synthetic translations are created.
