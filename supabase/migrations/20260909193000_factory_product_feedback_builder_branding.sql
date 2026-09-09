-- Product Feedback builder content stays campaign-owned. Response snapshots remain immutable.
alter table public.factory_product_feedback_campaigns
  add column if not exists content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  add column if not exists branding jsonb not null default '{}'::jsonb check (jsonb_typeof(branding) = 'object');

alter table public.factory_product_feedback_campaigns
  drop constraint if exists factory_product_feedback_campaigns_default_language_check;
alter table public.factory_product_feedback_campaigns
  add constraint factory_product_feedback_campaigns_default_language_check
  check (default_language in ('en', 'zh', 'ms'));

alter table public.factory_product_feedback_responses
  drop constraint if exists factory_product_feedback_responses_language_check;
alter table public.factory_product_feedback_responses
  add constraint factory_product_feedback_responses_language_check
  check (language in ('en', 'zh', 'ms'));

create or replace function public.factory_product_feedback_translation_authorize()
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.factory_product_feedback_actor();
  if not (public.current_user_has_permission('factory_product_feedback.create')
    or public.current_user_has_permission('factory_product_feedback.edit')
    or public.current_user_has_permission('factory_product_feedback.manage')) then
    raise exception using errcode = '42501', message = 'Product Feedback management permission is required.';
  end if;
  return true;
end; $$;

create or replace function public.factory_product_feedback_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_product_feedback_actor();
  v_id uuid := nullif(p_campaign->>'id','')::uuid;
  v_existing public.factory_product_feedback_campaigns%rowtype;
  v_saved public.factory_product_feedback_campaigns%rowtype;
  v_questions jsonb := coalesce(p_campaign->'questions','[]'::jsonb);
  v_content jsonb := coalesce(p_campaign->'content','{}'::jsonb);
  v_branding jsonb := coalesce(p_campaign->'branding','{}'::jsonb);
begin
  if not (public.current_user_has_permission('factory_product_feedback.create') or public.current_user_has_permission('factory_product_feedback.edit') or public.current_user_has_permission('factory_product_feedback.manage')) then raise exception using errcode = '42501', message = 'Product Feedback management permission is required.'; end if;
  if trim(coalesce(p_campaign->>'name','')) = '' then raise exception using errcode = '22023', message = 'Campaign name is required.'; end if;
  if jsonb_typeof(v_questions) <> 'array' then raise exception using errcode='22023', message='Questions must be an ordered array.'; end if;
  if jsonb_typeof(v_content) <> 'object' or jsonb_typeof(v_branding) <> 'object' then raise exception using errcode='22023', message='Campaign content and branding must be objects.'; end if;
  if v_id is not null then
    select * into v_existing from public.factory_product_feedback_campaigns where id=v_id for update;
    if not found then raise exception using errcode='22023', message='Campaign was not found.'; end if;
    if v_existing.status <> 'draft' and exists(select 1 from public.factory_product_feedback_responses where campaign_id=v_id) and v_questions is distinct from v_existing.questions then raise exception using errcode='22023', message='Form questions are immutable after responses have been submitted.'; end if;
    update public.factory_product_feedback_campaigns set
      name=trim(p_campaign->>'name'), finished_good_id=nullif(p_campaign->>'finished_good_id','')::uuid,
      event_label=nullif(trim(p_campaign->>'event_label'),''), starts_on=nullif(p_campaign->>'starts_on','')::date,
      ends_on=nullif(p_campaign->>'ends_on','')::date, status=coalesce(nullif(p_campaign->>'status',''), v_existing.status),
      default_language=coalesce(nullif(p_campaign->>'default_language',''), 'en'),
      thank_you_en=nullif(p_campaign->>'thank_you_en',''), thank_you_zh=nullif(p_campaign->>'thank_you_zh',''),
      questions=v_questions, content=v_content, branding=v_branding,
      form_version=case when v_questions is distinct from v_existing.questions then v_existing.form_version+1 else v_existing.form_version end,
      updated_by=v_actor, updated_at=now() where id=v_id returning * into v_saved;
  else
    insert into public.factory_product_feedback_campaigns(name,finished_good_id,event_label,starts_on,ends_on,status,default_language,thank_you_en,thank_you_zh,questions,content,branding,created_by,updated_by)
    values(trim(p_campaign->>'name'),nullif(p_campaign->>'finished_good_id','')::uuid,nullif(trim(p_campaign->>'event_label'),''),nullif(p_campaign->>'starts_on','')::date,nullif(p_campaign->>'ends_on','')::date,coalesce(nullif(p_campaign->>'status',''),'draft'),coalesce(nullif(p_campaign->>'default_language',''),'en'),nullif(p_campaign->>'thank_you_en',''),nullif(p_campaign->>'thank_you_zh',''),v_questions,v_content,v_branding,v_actor,v_actor)
    returning * into v_saved;
  end if;
  return to_jsonb(v_saved);
end; $$;

create or replace function public.factory_product_feedback_public_entry(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.factory_product_feedback_campaigns%rowtype; v_variant public.factory_product_feedback_variants%rowtype;
begin
  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id=p_token or exists (select 1 from public.factory_product_feedback_variants v where v.campaign_id=c.id and v.public_token=p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id=v_campaign.id and public_token=p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > current_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < current_date) or (v_variant.id is not null and not v_variant.is_active) then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available',true,'campaign',jsonb_build_object(
    'name',v_campaign.name,'event_label',v_campaign.event_label,'default_language',v_campaign.default_language,
    'thank_you_en',v_campaign.thank_you_en,'thank_you_zh',v_campaign.thank_you_zh,
    'questions',v_campaign.questions,'content',v_campaign.content,'branding',v_campaign.branding
  ),'variant',case when v_variant.id is null then null else jsonb_build_object('name',v_variant.name) end);
end; $$;

create or replace function public.factory_product_feedback_public_submit(p_token text, p_answers jsonb, p_language text default 'en', p_session_token text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.factory_product_feedback_campaigns%rowtype; v_variant public.factory_product_feedback_variants%rowtype; v_hash text := nullif(md5(coalesce(p_session_token,'')), md5('')); v_repeat integer; v_question jsonb; v_key text; v_saved public.factory_product_feedback_responses%rowtype;
begin
  if jsonb_typeof(p_answers) <> 'object' then raise exception using errcode='22023',message='Answers must be an object.'; end if;
  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id=p_token or exists (select 1 from public.factory_product_feedback_variants v where v.campaign_id=c.id and v.public_token=p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id=v_campaign.id and public_token=p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > current_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < current_date) or (v_variant.id is not null and not v_variant.is_active) then raise exception using errcode='22023',message='This feedback link is unavailable.'; end if;
  for v_question in select value from jsonb_array_elements(v_campaign.questions) loop v_key := v_question->>'key'; if coalesce((v_question->>'required')::boolean, false) and not (p_answers ? v_key) then raise exception using errcode='22023',message='Please answer all required questions.'; end if; end loop;
  select count(*) + 1 into v_repeat from public.factory_product_feedback_responses where campaign_id=v_campaign.id and variant_id is not distinct from v_variant.id and session_hash is not distinct from v_hash;
  insert into public.factory_product_feedback_responses(campaign_id,variant_id,form_version,questions_snapshot,answers,language,session_hash,repeat_index) values(v_campaign.id,v_variant.id,v_campaign.form_version,v_campaign.questions,p_answers,case when p_language in ('zh','ms') then p_language else 'en' end,v_hash,v_repeat) returning * into v_saved;
  return jsonb_build_object('submitted',true,'response',v_saved.public_response_id,'repeat_index',v_saved.repeat_index);
end; $$;

revoke all on function public.factory_product_feedback_translation_authorize() from public, anon, authenticated;
grant execute on function public.factory_product_feedback_translation_authorize() to authenticated;
