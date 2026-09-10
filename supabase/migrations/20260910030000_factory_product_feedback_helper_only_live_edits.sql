-- Response snapshots preserve the form shown to each respondent. After a response
-- exists, only localized helper copy may be amended for future respondents.
create or replace function public.factory_product_feedback_questions_differ_only_by_helpers(
  p_existing jsonb,
  p_next jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(p_existing) = 'array'
    and jsonb_typeof(p_next) = 'array'
    and jsonb_array_length(p_existing) = jsonb_array_length(p_next)
    and coalesce((
      select jsonb_agg(question - array['helper_en', 'helper_zh', 'helper_ms'] order by ordinal)
      from jsonb_array_elements(p_existing) with ordinality as items(question, ordinal)
    ), '[]'::jsonb) = coalesce((
      select jsonb_agg(question - array['helper_en', 'helper_zh', 'helper_ms'] order by ordinal)
      from jsonb_array_elements(p_next) with ordinality as items(question, ordinal)
    ), '[]'::jsonb);
$$;

create or replace function public.factory_product_feedback_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_product_feedback_actor();
  v_id uuid := nullif(p_campaign->>'id','')::uuid;
  v_existing public.factory_product_feedback_campaigns%rowtype;
  v_saved public.factory_product_feedback_campaigns%rowtype;
  v_questions jsonb := p_campaign->'questions';
  v_content jsonb := p_campaign->'content';
  v_branding jsonb := p_campaign->'branding';
  v_contact_collection jsonb := p_campaign->'contact_collection';
begin
  if not (public.current_user_has_permission('factory_product_feedback.create') or public.current_user_has_permission('factory_product_feedback.edit') or public.current_user_has_permission('factory_product_feedback.manage')) then
    raise exception using errcode = '42501', message = 'Product Feedback management permission is required.';
  end if;
  if trim(coalesce(p_campaign->>'name','')) = '' then
    raise exception using errcode = '22023', message = 'Campaign name is required.';
  end if;

  if v_id is not null then
    select * into v_existing from public.factory_product_feedback_campaigns where id = v_id for update;
    if not found then raise exception using errcode = '22023', message = 'Campaign was not found.'; end if;
    v_questions := coalesce(v_questions, v_existing.questions, '[]'::jsonb);
    v_content := coalesce(v_content, v_existing.content, '{}'::jsonb);
    v_branding := coalesce(v_branding, v_existing.branding, '{}'::jsonb);
    v_contact_collection := coalesce(v_contact_collection, v_existing.contact_collection, '{}'::jsonb);
  else
    v_questions := coalesce(v_questions, '[]'::jsonb);
    v_content := coalesce(v_content, '{}'::jsonb);
    v_branding := coalesce(v_branding, '{}'::jsonb);
    v_contact_collection := coalesce(v_contact_collection, '{}'::jsonb);
  end if;

  if jsonb_typeof(v_questions) <> 'array' then raise exception using errcode = '22023', message = 'Questions must be an ordered array.'; end if;
  if jsonb_typeof(v_content) <> 'object' or jsonb_typeof(v_branding) <> 'object' or jsonb_typeof(v_contact_collection) <> 'object' then
    raise exception using errcode = '22023', message = 'Campaign content, branding, and contact collection must be objects.';
  end if;
  if coalesce(v_contact_collection->>'enabled', 'false') not in ('true', 'false') then
    raise exception using errcode = '22023', message = 'Contact collection enabled must be true or false.';
  end if;
  if v_contact_collection ? 'prompt' and jsonb_typeof(v_contact_collection->'prompt') <> 'object' then
    raise exception using errcode = '22023', message = 'Contact collection prompt must be localized content.';
  end if;

  if v_id is not null then
    if v_existing.status <> 'draft'
      and exists(select 1 from public.factory_product_feedback_responses where campaign_id = v_id)
      and v_questions is distinct from v_existing.questions
      and not public.factory_product_feedback_questions_differ_only_by_helpers(v_existing.questions, v_questions) then
      raise exception using errcode = '22023', message = 'Form questions are immutable after responses have been submitted.';
    end if;
    update public.factory_product_feedback_campaigns set
      name = trim(p_campaign->>'name'),
      finished_good_id = nullif(p_campaign->>'finished_good_id','')::uuid,
      event_label = nullif(trim(p_campaign->>'event_label'),''),
      starts_on = nullif(p_campaign->>'starts_on','')::date,
      ends_on = nullif(p_campaign->>'ends_on','')::date,
      status = coalesce(nullif(p_campaign->>'status',''), v_existing.status),
      default_language = coalesce(nullif(p_campaign->>'default_language',''), 'en'),
      thank_you_en = nullif(p_campaign->>'thank_you_en',''),
      thank_you_zh = nullif(p_campaign->>'thank_you_zh',''),
      questions = v_questions,
      content = v_content,
      branding = v_branding,
      contact_collection = v_contact_collection,
      form_version = case when v_questions is distinct from v_existing.questions then v_existing.form_version + 1 else v_existing.form_version end,
      updated_by = v_actor,
      updated_at = now()
    where id = v_id returning * into v_saved;
  else
    insert into public.factory_product_feedback_campaigns(
      name, finished_good_id, event_label, starts_on, ends_on, status, default_language,
      thank_you_en, thank_you_zh, questions, content, branding, contact_collection, created_by, updated_by
    ) values (
      trim(p_campaign->>'name'), nullif(p_campaign->>'finished_good_id','')::uuid,
      nullif(trim(p_campaign->>'event_label'),''), nullif(p_campaign->>'starts_on','')::date,
      nullif(p_campaign->>'ends_on','')::date, coalesce(nullif(p_campaign->>'status',''),'draft'),
      coalesce(nullif(p_campaign->>'default_language',''),'en'), nullif(p_campaign->>'thank_you_en',''),
      nullif(p_campaign->>'thank_you_zh',''), v_questions, v_content, v_branding, v_contact_collection, v_actor, v_actor
    ) returning * into v_saved;
  end if;
  return to_jsonb(v_saved);
end; $$;
