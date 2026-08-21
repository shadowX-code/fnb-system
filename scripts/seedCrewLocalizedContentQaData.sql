-- FeedX Crew localized-content examples.
-- STAGING ONLY. Reusable QA data, never a production migration.
-- Curated translations are labelled Reviewed; this seed never pretends they were AI-generated.

begin;

create or replace function pg_temp.seed_localized_example(
  p_domain text,
  p_version_id uuid,
  p_outlet_id uuid,
  p_unit_key text,
  p_source_language text,
  p_source text,
  p_target_language text,
  p_target_value text,
  p_target_status text
) returns void language plpgsql set search_path=public,extensions,pg_temp as $$
declare v_unit uuid; v_hash text;
begin
  v_hash:=encode(extensions.digest(convert_to(to_jsonb(p_source)::text,'UTF8'),'sha256'),'hex');
  insert into public.crew_localized_content_units(domain,outlet_id,version_id,unit_key,field_kind,source_language,source_value,source_revision,source_hash)
  values(p_domain,p_outlet_id,p_version_id,p_unit_key,'plain_text',p_source_language,to_jsonb(p_source),2,v_hash)
  on conflict(domain,version_id,unit_key) do update set source_language=excluded.source_language,source_value=excluded.source_value,source_revision=excluded.source_revision,source_hash=excluded.source_hash,updated_at=now()
  returning id into v_unit;

  insert into public.crew_localized_content_translations(unit_id,language_code,translated_value,status,source_revision,source_hash,manually_edited_at,reviewed_at)
  values(v_unit,p_target_language,to_jsonb(p_target_value),p_target_status,
    case when p_target_status='outdated' then 1 else 2 end,
    case when p_target_status='outdated' then repeat('0',64) else v_hash end,
    case when p_target_status='reviewed' then now() end,
    case when p_target_status='reviewed' then now() end)
  on conflict(unit_id,language_code) do update set translated_value=excluded.translated_value,status=excluded.status,
    source_revision=excluded.source_revision,source_hash=excluded.source_hash,manually_edited_at=excluded.manually_edited_at,
    reviewed_at=excluded.reviewed_at,updated_at=now();
end; $$;

do $$
declare v_sop record; v_journey record; v_task record;
begin
  select v.id,s.outlet_id into v_sop from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.status='draft' and s.title ilike '%QA%' order by v.created_at desc limit 1;
  select j.id,j.outlet_id into v_journey from public.crew_journeys j where j.status='draft' and j.name ilike '%QA%' order by j.created_at desc limit 1;
  select t.id,t.outlet_id into v_task from public.crew_operation_templates t where t.status='draft' and t.name ilike '[QA]%' order by t.created_at desc limit 1;
  if v_sop.id is null or v_journey.id is null or v_task.id is null then
    raise exception 'Create/reuse one QA Draft for SOP, Onboarding and Task before running the localized-content QA seed.';
  end if;
  -- English source + manually reviewed Chinese. Malay is intentionally Missing for fallback QA.
  perform pg_temp.seed_localized_example('sop',v_sop.id,v_sop.outlet_id,'sop.title','en','[QA] Localized SOP','zh-CN','[QA] 多语言 SOP','reviewed');
  -- Chinese source + reviewed English + stale Malay after a simulated source revision.
  perform pg_temp.seed_localized_example('task',v_task.id,v_task.outlet_id,'task.name','zh-CN','[QA] 多语言任务','en','[QA] Localized Task','reviewed');
  perform pg_temp.seed_localized_example('task',v_task.id,v_task.outlet_id,'task.name','zh-CN','[QA] 多语言任务','ms','[QA] Tugas Berbilang Bahasa (stale)','outdated');
  -- Bahasa Melayu source + reviewed English + stale Chinese.
  perform pg_temp.seed_localized_example('onboarding',v_journey.id,v_journey.outlet_id,'journey.title','ms','[QA] Onboarding Berbilang Bahasa','en','[QA] Localized Onboarding','reviewed');
  perform pg_temp.seed_localized_example('onboarding',v_journey.id,v_journey.outlet_id,'journey.title','ms','[QA] Onboarding Berbilang Bahasa','zh-CN','[QA] 多语言入职培训（待更新）','outdated');
end; $$;

commit;
